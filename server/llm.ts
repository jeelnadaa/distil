import { z } from "zod";
import { AppError } from "./errors.ts";
import type { Providers } from "./providers/service.ts";
import type { ChatMessage, Usage } from "./providers/types.ts";
import type { ModelRef, SettingsStore } from "./settings.ts";
import { estimateTokens, type UsageStore } from "./usage.ts";

// One-shot model calls for background agents: each call checks caps first (F-1106), records its
// usage under the agent's role, and structured replies are validated, with one retry that carries
// the validation error back to the model (F-405).

export type LlmDeps = { providers: Providers; settings: SettingsStore; usage: UsageStore };
export type Slot = "strong" | "cheap";
export type CallOptions = {
  slot: Slot; role: string; folderId: string | null; system: string; prompt: string;
  maxTokens?: number; signal?: AbortSignal;
};

export function modelFor(settings: SettingsStore, slot: Slot): ModelRef {
  const { strong, cheap } = settings.get().models;
  const ref = slot === "cheap" ? (cheap ?? strong) : strong;
  if (!ref) throw new AppError(400, "no_model", "Pick a model in Settings › Models first.");
  return ref;
}

export async function complete(deps: LlmDeps, o: CallOptions, history: ChatMessage[] = []): Promise<string> {
  const ref = modelFor(deps.settings, o.slot);
  const cap = deps.usage.capStatus(deps.settings.get().caps, ref.provider);
  if (cap.state === "blocked") throw new AppError(429, "cap_reached", "A token cap was reached, so Distil paused here. Raise the cap or wait for it to reset, then resume.", cap);
  const messages: ChatMessage[] = [...history, { role: "user", content: o.prompt }];
  let text = "";
  let reported: Usage | null = null;
  try {
    for await (const event of deps.providers.stream(ref, { system: o.system, messages, maxTokens: o.maxTokens, signal: o.signal })) {
      if (event.type === "text") text += event.text;
      else reported = event.usage;
    }
  } finally {
    deps.usage.record({
      provider: ref.provider, model: ref.id, role: o.role, chatId: null, folderId: o.folderId,
      usage: reported ?? { input: estimateTokens(o.system + messages.map((m) => m.content).join("")), output: estimateTokens(text), cached: 0, reasoning: 0 },
      estimated: !reported,
    });
  }
  return text;
}

// Pulls the JSON object out of a reply that may be wrapped in a code fence or a sentence.
export function parseJsonReply(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1];
  const source = fenced ?? text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end < start) throw new Error("The reply contained no JSON object.");
  return JSON.parse(source.slice(start, end + 1));
}

export async function completeJson<T extends z.ZodType>(deps: LlmDeps, schema: T, o: CallOptions): Promise<z.infer<T>> {
  const first = await complete(deps, o);
  const check = (text: string) => {
    try {
      const parsed = schema.safeParse(parseJsonReply(text));
      return parsed.success ? { ok: true as const, data: parsed.data } : { ok: false as const, error: z.prettifyError(parsed.error) };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  };
  const result = check(first);
  if (result.ok) return result.data;
  const retry = check(await complete(deps, {
    ...o, prompt: `Your reply could not be used:\n${result.error}\n\nReply again with only the corrected JSON.`,
  }, [{ role: "user", content: o.prompt }, { role: "assistant", content: first }]));
  if (retry.ok) return retry.data;
  throw new AppError(502, "invalid_model_output", `The model's reply didn't match the expected format twice (${retry.error.split("\n")[0]}).`);
}
