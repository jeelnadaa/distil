import { z } from "zod";
import type { Db } from "../db.ts";
import type { Jobs } from "../jobs.ts";
import type { Learner } from "../learning/learner.ts";
import { completeJson, type LlmDeps } from "../llm.ts";
import { type Briefs, briefText } from "./brief.ts";
import { AIDS, type DraftUnit, reviewBatch } from "./coverage.ts";
import { EXAM_WEIGHTS, NO_WEIGHTS, PLAN_SYSTEM, SKILL_ONLY_PLAN, SKILL_PLAN } from "./prompts.ts";
import { localDate } from "./schedule.ts";
import { itemsInOrder, parts, type PlanItem } from "./sections.ts";
import type { Plans } from "./store.ts";

// The Planner (F-501, F-304, F-508, F-510): the ledger is planned one part at a time on the strong model.
// Each reply is reviewed in code; problems go back to the model, and after the last attempt the review
// repairs the reply itself, so every in-scope item ends up in a lesson. Parts are saved as they finish,
// so a stopped or crashed job resumes with the items still unplanned. "build" fills a draft that replaces
// the active plan when done; "extend" adds lessons for items the active plan doesn't map yet.

// replace: a saved plan the new one takes the place of, removed once the new plan is active.
export type PlanJob = { planId: string; mode: "build" | "extend"; replace?: string };
const ATTEMPTS = 3;
// The text of exam papers and syllabi shown to the planner, so it can judge what is examined.
const EXAM_EXCERPT_CHARS = 8000;
export const EXAM_MATERIAL = /syllab|past[\s_-]*paper|question[\s_-]*paper|specimen|mid[\s_-]*(?:term|sem)|final[\s_-]*exam|\bexam/i;

const DraftLesson = z.object({
  key: z.coerce.string().min(1).max(40),
  title: z.string().min(1).max(200),
  summary: z.string().max(600).default(""),
  kind: z.enum(["lesson", "project"]).catch("lesson"),
  minutes: z.number().catch(0),
  weight: z.number().catch(1),
  aids: z.array(z.string()).catch([]).transform((a) => a.filter((x): x is (typeof AIDS)[number] => (AIDS as readonly string[]).includes(x))),
  items: z.array(z.coerce.string()).default([]),
  after: z.array(z.coerce.string()).default([]),
});
const Reply = z.object({ units: z.array(z.object({ title: z.string().min(1).max(200), summary: z.string().max(600).default(""), lessons: z.array(DraftLesson) })) });

// Excerpts of the folder's exam papers and syllabi, found by name (F-508).
export function examEvidence(db: Db, folderId: string): string {
  const materials = (db.prepare(`WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id)
    SELECT m.id, m.name FROM materials m JOIN sub ON m.folder_id = sub.id WHERE m.status = 'ready' ORDER BY m.created_at`).all(folderId) as { id: string; name: string }[])
    .filter((m) => EXAM_MATERIAL.test(m.name));
  let left = EXAM_EXCERPT_CHARS;
  const out: string[] = [];
  for (const m of materials) {
    if (left <= 0) break;
    const text = (db.prepare("SELECT text FROM chunks WHERE material_id = ? ORDER BY ord").all(m.id) as { text: string }[]).map((c) => c.text).join("\n").slice(0, left);
    left -= text.length;
    out.push(`<exam-material name="${m.name}">\n${text}\n</exam-material>`);
  }
  return out.join("\n\n");
}

type PartInput = { folderId: string; brief: string; part: PlanItem[]; index: number; count: number; earlier: { key: string; title: string }[]; skill: boolean; exam: string; signal: AbortSignal };

// Plans one part. Short ids (i1, i2 …) keep the prompt small and are mapped back to item ids.
export async function planPart(llm: LlmDeps, p: PartInput): Promise<{ units: DraftUnit[]; problems: string[] }> {
  const ids = new Map(p.part.map((item, i) => [`i${i + 1}`, item.id]));
  let section = "";
  const lines = p.part.map((item, i) => {
    const head = item.section !== section ? `## ${(section = item.section)}\n` : "";
    return `${head}i${i + 1} [${item.type}] ${item.title}`;
  });
  const system = [PLAN_SYSTEM, p.exam ? EXAM_WEIGHTS : NO_WEIGHTS, p.skill && (p.part.length ? SKILL_PLAN : SKILL_ONLY_PLAN)].filter(Boolean).join("\n\n");
  const base = [
    `Study brief:\n${p.brief}`,
    p.count > 1 && `This is part ${p.index + 1} of ${p.count} of the ledger.`,
    p.earlier.length && `Lessons already planned (use their keys in "after" when a lesson builds on them):\n${p.earlier.map((l) => `${l.key} ${l.title}`).join("\n")}`,
    p.part.length ? `Items to plan (${p.part.length}), as id [type] title, under their sections:\n${lines.join("\n")}` : "",
    p.exam,
  ].filter(Boolean).join("\n\n");
  const earlier = new Set(p.earlier.map((l) => l.key));
  let prompt = base;
  let review: { units: DraftUnit[]; problems: string[] } = { units: [], problems: [] };
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const reply = await completeJson(llm, Reply, { slot: "strong", role: "planner", folderId: p.folderId, system, prompt, maxTokens: 16384, signal: p.signal });
    review = reviewBatch(reply.units, { items: [...ids.keys()], earlier, projects: p.skill });
    if (!review.problems.length) break;
    prompt = `${base}\n\nYour last plan for this part had these problems:\n- ${review.problems.join("\n- ")}\nReply with the whole corrected plan for this part.`;
  }
  for (const unit of review.units) {
    for (const l of unit.lessons) {
      l.items = l.items.map((id) => ids.get(id)!);
      // Exam weight only counts when there is exam evidence; heavily examined lessons get time for practice.
      l.weight = p.exam ? l.weight : 1;
      l.minutes = Math.round(l.minutes * (1 + (l.weight - 1) / 4));
    }
  }
  return review;
}

export function registerPlanner(jobs: Jobs, deps: LlmDeps & { db: Db; plans: Plans; briefs: Briefs; learner: Learner }) {
  const { db, plans, briefs, learner } = deps;
  jobs.register("plan", async (job, { signal, progress, note }) => {
    const { planId, mode, replace } = job.params as PlanJob;
    const folderId = job.folderId!;
    const stored = briefs.nearest(folderId);
    const brief = stored ? briefText(stored.brief, localDate()) : "- Goal: learn everything in the material";
    const llm: LlmDeps = { ...deps, onAnswer: (ref, fellBack) => note(fellBack ? `Answered by ${deps.providers.describe(ref)}, a fallback` : null) };
    const skill = plans.get(planId).kind === "skill";
    const exam = examEvidence(db, folderId);

    const mapped = new Set(plans.get(planId).lessons.flatMap((l) => l.items));
    const all = itemsInOrder(db, folderId);
    const todo = parts(all.filter((i) => !mapped.has(i.id)));
    // A skill plan with no material is planned from the goal in one part; an unfinished one resumes with what's left.
    if (skill && !all.length && !plans.get(planId).lessons.length) todo.push([]);
    const total = todo.length + 1;
    progress(0, total);
    let problems = 0;

    for (const [index, part] of todo.entries()) {
      if (signal.aborted) return;
      const plan = plans.get(planId);
      const earlier = plan.lessons.map((l, i) => ({ key: `P${i + 1}`, title: l.title, id: l.id }));
      const review = await planPart(llm, { folderId, brief, part, index, count: todo.length, earlier, skill, exam, signal });
      if (signal.aborted) return;
      problems += review.problems.length ? 1 : 0;
      plans.append(planId, review.units, new Map(earlier.map((l) => [l.key, l.id])));
      if (mode === "extend") learner.advance(part.map((i) => i.id), "planned");
      progress(index + 1, total);
    }
    if (mode === "build") {
      plans.activate(planId);
      if (replace) plans.remove(replace);
      learner.advance(plans.get(planId).lessons.flatMap((l) => l.items), "planned");
    }
    if (problems) note(`${problems} ${problems === 1 ? "part" : "parts"} needed fixing in code after the model's retries`);
    progress(total, total);
  });
}

export const planLabel = (folderName: string, mode: PlanJob["mode"]) => mode === "build" ? `Planning ${folderName}` : `Planning new items in ${folderName}`;
