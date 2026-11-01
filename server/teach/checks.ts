import { z } from "zod";
import { completeJson, type LlmDeps } from "../llm.ts";

// Check questions (F-604): the teacher writes one after each step. Multiple choice, numbers and ordering
// are graded in code; short answers and explanations by the cheap model against the teacher's own answer.
// The answer never reaches the browser until the learner has answered.

const prompt = z.string().min(1).max(1200);
const why = z.string().max(1200).default("");
export const CheckSpec = z.discriminatedUnion("type", [
  z.object({ type: z.literal("mcq"), prompt, options: z.array(z.string().min(1).max(300)).min(2).max(6), answer: z.number().int().min(0), why }),
  z.object({ type: z.literal("numeric"), prompt, answer: z.number(), tolerance: z.number().min(0).default(0.01), unit: z.string().max(30).default(""), why }),
  z.object({ type: z.literal("order"), prompt, steps: z.array(z.string().min(1).max(300)).min(3).max(7), why }),
  z.object({ type: z.literal("short"), prompt, answer: z.string().min(1).max(600), why }),
  z.object({ type: z.literal("explain"), prompt, answer: z.string().min(1).max(1200), why }),
]).refine((c) => c.type !== "mcq" || c.answer < c.options.length, { message: "answer must be the index of one of the options" });
export type CheckSpec = z.infer<typeof CheckSpec>;

export type Verdict = "right" | "partly" | "wrong" | "unknown";
export type Confidence = "guess" | "unsure" | "sure";
export type Response = { value: string | number | number[] | null; confidence: Confidence | null; thinking: string };
// feedback is about the learner's own answer (from the grading model); why explains the right one.
export type Result = Response & { verdict: Verdict; feedback: string; answer: string; why: string };

// What the browser sees before answering: no answer, and ordering steps shuffled.
export type PublicCheck =
  | { type: "mcq"; prompt: string; options: string[] }
  | { type: "numeric"; prompt: string; unit: string }
  | { type: "order"; prompt: string; steps: string[] }
  | { type: "short" | "explain"; prompt: string };

// A fixed shuffle per check, so a reload shows the same order; the learner answers with the original indexes.
export function shuffled(n: number, seed: string): number[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const j = Math.abs(h) % (i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  // Never shown already in order.
  return order.every((v, i) => v === i) ? [...order.slice(1), order[0]!] : order;
}

export function publicCheck(id: string, spec: CheckSpec): PublicCheck {
  if (spec.type === "mcq") return { type: "mcq", prompt: spec.prompt, options: spec.options };
  if (spec.type === "numeric") return { type: "numeric", prompt: spec.prompt, unit: spec.unit };
  if (spec.type === "order") {
    return { type: "order", prompt: spec.prompt, steps: shuffled(spec.steps.length, id).map((i) => spec.steps[i]!) };
  }
  return { type: spec.type, prompt: spec.prompt };
}

// The correct answer in words, shown with the feedback once answered.
export function answerText(spec: CheckSpec): string {
  if (spec.type === "mcq") return spec.options[spec.answer]!;
  if (spec.type === "numeric") return `${spec.answer}${spec.unit ? ` ${spec.unit}` : ""}`;
  if (spec.type === "order") return spec.steps.join(" → ");
  return spec.answer;
}

// The learner's answer in words, for the teacher's transcript.
export function responseText(id: string, spec: CheckSpec, value: Response["value"]): string {
  if (value === null || value === "") return "I don't know";
  if (spec.type === "mcq") return spec.options[Number(value)] ?? String(value);
  if (spec.type === "order" && Array.isArray(value)) {
    const shown = shuffled(spec.steps.length, id);
    return value.map((p) => spec.steps[shown[p] ?? -1] ?? "?").join(" → ");
  }
  return String(value);
}

export const parseNumber =(raw: string | number): number | null => {
  if (typeof raw === "number") return raw;
  const m = raw.replace(/,/g, "").replace(/\s+/g, "").match(/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i);
  return m ? Number(m[0]) : null;
};

// Grades in code where the answer is exact; null means a model has to judge it. An ordering answer lists
// the shown steps (by their shown position) in the learner's order.
export function gradeExact(id: string, spec: CheckSpec, value: Response["value"]): Verdict | null {
  if (value === null) return "unknown";
  if (spec.type === "mcq") return Number(value) === spec.answer ? "right" : "wrong";
  if (spec.type === "numeric") {
    const n = parseNumber(value as string | number);
    if (n === null) return "wrong";
    const tolerance = Math.max(Math.abs(spec.answer) * spec.tolerance, 1e-9);
    return Math.abs(n - spec.answer) <= tolerance ? "right" : "wrong";
  }
  if (spec.type === "order") {
    const shown = shuffled(spec.steps.length, id);
    const got = (Array.isArray(value) ? value : []).map((p) => shown[p] ?? -1);
    const placed = got.filter((v, i) => v === i).length;
    return placed === spec.steps.length && got.length === spec.steps.length ? "right" : placed * 2 >= spec.steps.length ? "partly" : "wrong";
  }
  return null;
}

const Judged = z.object({ verdict: z.enum(["right", "partly", "wrong"]), feedback: z.string().max(800).default("") });
const JUDGE = `You grade a learner's answer to a check question in a lesson. You get the question, the teacher's model answer and the learner's answer.
Reply with JSON only: {"verdict": "right" | "partly" | "wrong", "feedback": "one or two sentences to the learner"}
- right: the idea is correct, even in other words or with small slips in wording.
- partly: some of it is correct but something that matters is missing or wrong.
- wrong: the main idea is wrong or missing.
The feedback says what was right and what was not, plainly, without giving a lecture.`;

export async function gradeWithModel(deps: LlmDeps, spec: CheckSpec, answer: string, folderId: string | null): Promise<{ verdict: Verdict; feedback: string }> {
  const reply = await completeJson(deps, Judged, {
    slot: "cheap", role: "grader", folderId, system: JUDGE, maxTokens: 400,
    prompt: `Question: ${spec.prompt}\n\nModel answer: ${answerText(spec)}\n\nLearner's answer: ${answer.slice(0, 3000)}`,
  });
  return reply;
}
