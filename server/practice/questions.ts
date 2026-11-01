import { z } from "zod";
import { completeJson, type LlmDeps } from "../llm.ts";
import type { ImagePart } from "../providers/types.ts";
import { type CheckSpec, gradeExact } from "../teach/checks.ts";

// Practice and exam questions (F-802, F-805, F-806). Each is written together with its worked solution,
// a marking rubric and two progressive hints before any is shown, so grading never drifts from what was
// asked. Choice, number and ordering answers are marked in code; written ones by a model against the rubric.

export const LEVELS = ["worked", "completion", "direct", "composition", "open"] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_LABELS: Record<Level, string> = {
  worked: "Worked example", completion: "Completion", direct: "Direct", composition: "Composition", open: "Open problem",
};

const text = (max: number) => z.string().min(1).max(max);
const common = {
  prompt: text(3000),
  marks: z.number().int().min(1).max(30),
  level: z.enum(LEVELS).default("direct"),
  section: z.string().max(120).default(""),
  items: z.array(z.string()).min(1).max(6),
  solution: text(4000),
  rubric: z.array(z.object({ point: text(400), marks: z.number().int().min(1).max(30) })).min(1).max(8),
  hints: z.array(text(600)).max(2).default([]),
};
export const QuestionSpec = z.discriminatedUnion("type", [
  z.object({ type: z.literal("mcq"), ...common, options: z.array(text(400)).min(2).max(6), answer: z.number().int().min(0) }),
  z.object({ type: z.literal("numeric"), ...common, answer: z.number(), tolerance: z.number().min(0).max(0.5).default(0.01), unit: z.string().max(30).default("") }),
  z.object({ type: z.literal("order"), ...common, steps: z.array(text(300)).min(3).max(7) }),
  z.object({ type: z.literal("short"), ...common }),
  z.object({ type: z.literal("problem"), ...common }),
]).refine((q) => q.type !== "mcq" || q.answer < q.options.length, { message: "answer must be the index of one of the options" });
export type QuestionSpec = z.infer<typeof QuestionSpec>;
export type QuestionType = QuestionSpec["type"];

// A written answer can be typed, photographed (handwriting) or both.
export type AnswerValue = { value: string | number | number[] | null; photo: string | null };
export type Grade = {
  score: number; marks: number; met: boolean[]; feedback: string;
  // Ledger items the answer showed weren't recalled (F-806 "which item failed to come to mind").
  missed: string[];
};

// The rubric's marks are the question's marks; a model's sum that disagrees is scaled.
export const rubricTotal = (q: QuestionSpec) => q.rubric.reduce((sum, r) => sum + r.marks, 0);

// The same question as a teaching check, so the exact graders are shared.
const asCheck = (q: QuestionSpec): CheckSpec | null =>
  q.type === "mcq" ? { type: "mcq", prompt: q.prompt, options: q.options, answer: q.answer, why: "" }
  : q.type === "numeric" ? { type: "numeric", prompt: q.prompt, answer: q.answer, tolerance: q.tolerance, unit: q.unit, why: "" }
  : q.type === "order" ? { type: "order", prompt: q.prompt, steps: q.steps, why: "" }
  : null;

// Marks a choice, number or ordering in code; null when a model has to read it. An ordering answer is
// shown shuffled with the question's id as the seed, like a teaching check.
export function markExact(id: string, q: QuestionSpec, answer: AnswerValue): Grade | null {
  const check = asCheck(q);
  if (!check) return null;
  const verdict = gradeExact(id, check, answer.value);
  const share = verdict === "right" ? 1 : verdict === "partly" ? 0.5 : 0;
  const score = Math.round(q.marks * share * 2) / 2;
  return { score, marks: q.marks, met: q.rubric.map(() => share === 1), feedback: "", missed: share === 1 ? [] : q.items };
}

const Marked = z.object({
  met: z.array(z.boolean()),
  feedback: z.string().max(1200).default(""),
  missed: z.array(z.string()).default([]),
});

const MARKER = `You mark one answer to an exam or practice question against its rubric, like a fair, careful examiner.
You get the question, the worked solution, the rubric points (each with its marks), the ledger items the question tests (by key) and the learner's answer, typed and/or as a photo of handwriting.
Reply with JSON only: {"met": [true|false for each rubric point, in order], "feedback": "two or three sentences to the learner", "missed": ["keys of items the answer shows they didn't recall or misunderstood"]}
- Award a point when the answer shows it, in any wording or notation, even with small slips. Follow the working: a correct method with an arithmetic slip still earns the method points.
- Don't award points the answer doesn't show. A blank or unreadable answer meets nothing.
- Read handwriting generously; if a part is truly unreadable, say so in the feedback.
- The feedback says what earned marks and what was missing, plainly, without restating the whole solution.`;

export async function markWritten(deps: LlmDeps, q: QuestionSpec, answer: AnswerValue, itemKeys: Record<string, string>, folderId: string, signal?: AbortSignal): Promise<Grade> {
  const typed = typeof answer.value === "string" ? answer.value.trim() : "";
  if (!typed && !answer.photo) return { score: 0, marks: q.marks, met: q.rubric.map(() => false), feedback: "No answer was given.", missed: q.items };
  const keyOf = Object.fromEntries(Object.entries(itemKeys).map(([key, id]) => [id, key]));
  const images: ImagePart[] = answer.photo ? [dataUrlImage(answer.photo)] : [];
  const reply = await completeJson(deps, Marked, {
    slot: "strong", role: "grader", folderId, system: MARKER, maxTokens: 800, signal, images,
    prompt: [
      `Question (${q.marks} marks):\n${q.prompt}`,
      `Worked solution:\n${q.solution}`,
      `Rubric:\n${q.rubric.map((r, i) => `${i + 1}. [${r.marks}] ${r.point}`).join("\n")}`,
      `Items tested: ${q.items.map((id) => keyOf[id] ?? id).join(", ")}`,
      `Learner's answer:\n${typed.slice(0, 6000) || "(see the photo)"}${answer.photo ? "\n\nThe photo shows their handwritten working." : ""}`,
    ].join("\n\n"),
  });
  const met = q.rubric.map((_, i) => reply.met[i] === true);
  const earned = q.rubric.reduce((sum, r, i) => sum + (met[i] ? r.marks : 0), 0);
  const score = Math.round((earned / rubricTotal(q)) * q.marks * 2) / 2;
  const missed = reply.missed.map((k) => itemKeys[k] ?? k).filter((id) => q.items.includes(id));
  return { score, marks: q.marks, met, feedback: reply.feedback, missed: score < q.marks && !missed.length ? q.items : missed };
}

// A photo arrives as a data URL; providers want the type and the base64 apart.
export function dataUrlImage(url: string): ImagePart {
  const m = url.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error("A photo must be a JPEG, PNG or WebP data URL.");
  return { mime: m[1]!, data: m[2]! };
}
