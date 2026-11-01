import { z } from "zod";
import type { Db } from "../db.ts";
import { Brief, Depth } from "../learning/types.ts";
import { completeJson, type LlmDeps } from "../llm.ts";
import { BRIEF_SYSTEM } from "./prompts.ts";
import { daysBetween, localDate } from "./schedule.ts";
import type { PlanKind } from "./store.ts";

// The Brief Compiler (F-101…F-105): any request, even an empty one, becomes a Study Brief with a visible
// default for every field, plus at most three questions for what couldn't be inferred. The brief is stored
// per folder; a subfolder without its own uses the nearest one above it.

export type Question = { field: Askable; question: string; options: { label: string; value: string | number | null }[] };
export type Compiled = { brief: Brief; kind: PlanKind; questions: Question[] };
export type StoredBrief = { brief: Brief; kind: PlanKind; folderId: string; updatedAt: number };

export const MAX_QUESTIONS = 3;
const ASKABLE = ["goal", "scope", "level", "depth", "deadline", "hoursPerDay", "assessment"] as const;
type Askable = (typeof ASKABLE)[number];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const Reply = z.object({
  // Dates and hours the model gets wrong become "not set" rather than failing the whole brief.
  brief: z.preprocess((raw) => {
    const b = { ...(raw as Record<string, unknown>) };
    if (typeof b.deadline !== "string" || !DATE.test(b.deadline)) b.deadline = null;
    if (typeof b.hoursPerDay !== "number" || b.hoursPerDay <= 0 || b.hoursPerDay > 24) b.hoursPerDay = null;
    for (const k of ["scope", "level", "assessment"]) if (b[k] === null) delete b[k];
    return b;
  }, Brief),
  kind: z.enum(["course", "skill"]).catch("course"),
  questions: z.array(z.object({ field: z.string(), question: z.string().min(1).max(300), options: z.array(z.object({ label: z.coerce.string(), value: z.unknown() })) })).default([]),
});

// An answer option is kept only if its value is valid for its field.
const validValue = (field: Askable, value: unknown, today: string): value is string | number | null => {
  switch (field) {
    case "deadline": return value === null || (typeof value === "string" && DATE.test(value) && value > today);
    case "hoursPerDay": return value === null || (typeof value === "number" && value > 0 && value <= 24);
    case "depth": return Depth.safeParse(value).success;
    default: return typeof value === "string" && value.trim().length > 0 && value.length <= 300;
  }
};

// Code enforces what the prompt asks: no past deadline, at most three questions, one per askable field,
// each with 2 to 4 valid options.
export function cleanCompiled(reply: z.infer<typeof Reply>, today: string): Compiled {
  const brief = { ...reply.brief, deadline: reply.brief.deadline && reply.brief.deadline > today ? reply.brief.deadline : null };
  const seen = new Set<string>();
  const questions: Question[] = [];
  for (const q of reply.questions) {
    if (!(ASKABLE as readonly string[]).includes(q.field) || seen.has(q.field) || questions.length >= MAX_QUESTIONS) continue;
    const field = q.field as Askable;
    const options = q.options.filter((o) => o.label.trim() && validValue(field, o.value, today)).slice(0, 4)
      .map((o) => ({ label: o.label.trim().slice(0, 60), value: o.value as string | number | null }));
    if (options.length < 2) continue;
    seen.add(field);
    questions.push({ field, question: q.question.trim(), options });
  }
  return { brief, kind: reply.kind, questions };
}

export type BriefInput = {
  folderId: string; folderName: string; request: string; today: string; current: Brief | null;
  materials: { name: string; kind: string; length: number | null; unit: string | null }[]; sections: string[]; items: number;
};

export async function compileBrief(llm: LlmDeps, input: BriefInput, signal?: AbortSignal): Promise<Compiled> {
  const materials = input.materials.map((m) => `- ${m.name} (${m.kind}${m.length ? `, ${m.length} ${m.unit ?? "part"}s` : ""})`).join("\n");
  const prompt = [
    `Today: ${input.today}`,
    `Subject: ${input.folderName}`,
    `Request: ${input.request.trim() || "(none: infer everything)"}`,
    input.current && `Current brief (keep what still fits): ${JSON.stringify(input.current)}`,
    `Materials:\n${materials || "(none: topic only)"}`,
    input.items ? `The coverage ledger has ${input.items} items. Outline (section, items):\n${input.sections.slice(0, 60).join("\n")}${input.sections.length > 60 ? `\n… and ${input.sections.length - 60} more sections` : ""}` : "",
  ].filter(Boolean).join("\n\n");
  const reply = await completeJson(llm, Reply, { slot: "cheap", role: "brief", folderId: input.folderId, system: BRIEF_SYSTEM, prompt, signal });
  return cleanCompiled(reply, input.today);
}

export function createBriefs(db: Db, now = () => Date.now()) {
  type Row = { folder_id: string; data: string; kind: PlanKind; updated_at: number };
  const toStored = (r: Row): StoredBrief => ({ brief: Brief.parse(JSON.parse(r.data)), kind: r.kind, folderId: r.folder_id, updatedAt: r.updated_at });
  return {
    get(folderId: string): StoredBrief | null {
      const row = db.prepare("SELECT * FROM briefs WHERE folder_id = ?").get(folderId) as Row | undefined;
      return row ? toStored(row) : null;
    },
    // The folder's own brief, or the nearest one above it (F-104).
    nearest(folderId: string): StoredBrief | null {
      const row = db.prepare(`WITH RECURSIVE up(id, depth) AS (SELECT ?, 0 UNION ALL SELECT f.parent_id, up.depth + 1 FROM folders f JOIN up ON f.id = up.id WHERE f.parent_id IS NOT NULL)
        SELECT b.* FROM briefs b JOIN up ON b.folder_id = up.id ORDER BY up.depth LIMIT 1`).get(folderId) as Row | undefined;
      return row ? toStored(row) : null;
    },
    save(folderId: string, brief: Brief, kind: PlanKind): StoredBrief {
      db.prepare(`INSERT INTO briefs (folder_id, data, kind, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(folder_id) DO UPDATE SET data = excluded.data, kind = excluded.kind, updated_at = excluded.updated_at`).run(folderId, JSON.stringify(brief), kind, now());
      return this.get(folderId)!;
    },
  };
}
export type Briefs = ReturnType<typeof createBriefs>;

const DEPTH: Record<string, string> = { survey: "survey (the big picture)", standard: "standard", exam_ready: "exam-ready", mastery: "mastery (deep, with edge cases)" };

// The brief as a short block for any mode's system prompt (F-105), so a two-word question still gets an
// answer that fits the learner's goal, level and exam. Empty when no brief applies to the folder.
export function briefText(brief: Brief, today: string): string {
  const exam = brief.deadline
    ? `${brief.deadline} (${Math.max(0, daysBetween(today, brief.deadline))} days away)${brief.hoursPerDay ? `, studying ${brief.hoursPerDay} h a day` : ""}`
    : "";
  return [
    `- Goal: ${brief.goal}`,
    brief.scope && `- Scope: ${brief.scope}`,
    brief.level && `- What the learner already knows: ${brief.level}`,
    `- Depth: ${DEPTH[brief.depth]}`,
    exam && `- Exam: ${exam}`,
    brief.assessment && `- Assessment: ${brief.assessment}`,
    brief.language !== "English" && `- Language: answer in ${brief.language}`,
  ].filter(Boolean).join("\n");
}

export function briefContext(db: Db, folderId: string, today = localDate()): string {
  const stored = createBriefs(db).nearest(folderId);
  return stored ? `Study brief (what the learner is working towards; fit every answer to it):\n${briefText(stored.brief, today)}` : "";
}
