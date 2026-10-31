import { z } from "zod";
import { AppError } from "./errors.ts";
import type { Providers } from "./providers/service.ts";
import { ProviderError, type ChatMessage, type ImagePart, type Usage } from "./providers/types.ts";
import type { ModelRef, SettingsStore } from "./settings.ts";
import { estimateTokens, type UsageStore } from "./usage.ts";

// One-shot model calls for background agents: each call checks caps first (F-1106), records its
// usage under the agent's role, and walks the slot's fallback chain: a model that is rate-limited,
// down, out of quota or capped hands the call to the next one, and only when every model in the chain
// is busy does it wait and go round again. Structured replies are validated, with one retry that
// carries the validation error back to the model (F-405).

// wait is injectable so tests don't sleep. onAnswer hears which model answered each call.
export type LlmDeps = {
  providers: Providers; settings: SettingsStore; usage: UsageStore;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onAnswer?: (ref: ModelRef, fellBack: boolean) => void;
};

const ATTEMPTS = 5;
const BASE_DELAY_MS = 2000;
// A provider asking us to come back later than this is out of quota for the day, not busy.
export const MAX_WAIT_MS = 2 * 60 * 1000;

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const timer = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, ms);
  const stop = () => { clearTimeout(timer); reject(signal!.reason); };
  signal?.addEventListener("abort", stop, { once: true });
});

const retryable = (err: unknown) => err instanceof ProviderError && (err.status === 429 || err.status >= 500 || err.status === 0);

// "Please retry in 17h36m20.3s" (Gemini) or "retry after 30s"; null when the provider didn't say.
export function retryDelay(message: string): number | null {
  const m = message.match(/retry (?:in|after)\s+(?:(\d+)h)?\s*(?:(\d+)m(?!s))?\s*(?:([\d.]+)s)?/i);
  if (!m || !(m[1] || m[2] || m[3])) return null;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 1000;
}
export type Slot = "strong" | "cheap";
export type CallOptions = {
  slot: Slot; role: string; folderId: string | null; system: string; prompt: string;
  maxTokens?: number; signal?: AbortSignal; images?: ImagePart[]; videos?: string[];
};

const sameRef = (a: ModelRef, b: ModelRef) => a.provider === b.provider && a.id === b.id && (a.key ?? "") === (b.key ?? "");

// The slot's model followed by its fallbacks, without repeats. The cheap slot uses the strong chain while it's unset.
export function chainFor(settings: SettingsStore, slot: Slot): ModelRef[] {
  const { models, fallbacks } = settings.get();
  const chain = slot === "cheap" && models.cheap ? [models.cheap, ...fallbacks.cheap] : models.strong ? [models.strong, ...fallbacks.strong] : [];
  if (!chain.length) throw new AppError(400, "no_model", "Pick a model in Settings › Models first.");
  return chain.filter((ref, i) => chain.findIndex((other) => sameRef(other, ref)) === i);
}

export const modelFor = (settings: SettingsStore, slot: Slot): ModelRef => chainFor(settings, slot)[0]!;

// The slot to watch a video with: the cheap chain when it has a Gemini model, else the strong one when it does.
export function videoSlot(settings: SettingsStore): Slot | null {
  const hasGemini = (slot: Slot) => { try { return chainFor(settings, slot).some((r) => r.provider === "google"); } catch { return false; } };
  return hasGemini("cheap") ? "cheap" : hasGemini("strong") ? "strong" : null;
}

export async function complete(deps: LlmDeps, o: CallOptions, history: ChatMessage[] = []): Promise<string> {
  const wait = deps.wait ?? sleep;
  const all = chainFor(deps.settings, o.slot);
  const chain = o.videos?.length ? all.filter((r) => r.provider === "google") : all;
  if (!chain.length) throw new AppError(400, "needs_gemini", "Only Gemini models can watch videos. Pick a Gemini model in Settings › Models, or paste the transcript.");
  // Models out of quota for hours, or capped, sit out the rest of this call.
  const gone = new Set<ModelRef>();
  let last: unknown;
  let outOfQuota = false;
  for (let attempt = 1; ; attempt++) {
    let soonest: number | null = null;
    for (const ref of chain) {
      if (gone.has(ref)) continue;
      try {
        const text = await completeOnce(deps, ref, o, history);
        deps.onAnswer?.(ref, ref !== chain[0]);
        return text;
      } catch (err) {
        if (o.signal?.aborted) throw err;
        last = err;
        if (err instanceof AppError && err.code === "cap_reached") { gone.add(ref); continue; }
        if (!retryable(err)) throw err;
        const asked = retryDelay((err as Error).message);
        if (asked !== null && asked > MAX_WAIT_MS) { gone.add(ref); outOfQuota = true; continue; }
        const delay = asked ?? BASE_DELAY_MS * 2 ** (attempt - 1) * (0.75 + Math.random() / 2);
        soonest = Math.min(soonest ?? delay, delay);
      }
    }
    if (soonest === null) {
      if (!outOfQuota) throw last;
      const what = chain.length === 1 ? `${deps.providers.describe(chain[0]!)} is` : "Every model in this slot's fallback chain is";
      throw new AppError(429, "quota_exhausted", `${what} out of quota for now. Distil stopped here and keeps what it found; resume once the quota resets, or add a fallback model in Settings › Models.`);
    }
    if (attempt >= ATTEMPTS) throw last;
    await wait(soonest, o.signal);
  }
}

async function completeOnce(deps: LlmDeps, ref: ModelRef, o: CallOptions, history: ChatMessage[]): Promise<string> {
  const cap = deps.usage.capStatus(deps.settings.get().caps, ref.provider);
  if (cap.state === "blocked") throw new AppError(429, "cap_reached", "A token cap was reached, so Distil paused here. Raise the cap or wait for it to reset, then resume.", cap);
  const messages: ChatMessage[] = [...history, { role: "user", content: o.prompt, images: o.images, videos: o.videos }];
  let text = "";
  let reported: Usage | null = null;
  try {
    for await (const event of deps.providers.stream(ref, { system: o.system, messages, maxTokens: o.maxTokens, signal: o.signal })) {
      if (event.type === "text") text += event.text;
      else reported = event.usage;
    }
  } finally {
    // A request refused before any output (rate limit, outage) cost nothing.
    if (reported || text) deps.usage.record({
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
  // The correction is about format only, so the images aren't sent again.
  const retry = check(await complete(deps, {
    ...o, images: undefined, prompt: `Your reply could not be used:\n${result.error}\n\nReply again with only the corrected JSON.`,
  }, [{ role: "user", content: o.prompt }, { role: "assistant", content: first }]));
  if (retry.ok) return retry.data;
  throw new AppError(502, "invalid_model_output", `The model's reply didn't match the expected format twice (${retry.error.split("\n")[0]}).`);
}
