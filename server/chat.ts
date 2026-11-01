import { AppError } from "./errors.ts";
import type { Chat, Library } from "./library.ts";
import type { Message, Messages } from "./messages.ts";
import { ASK_SYSTEM, NAMER_SYSTEM } from "./prompts.ts";
import type { Providers } from "./providers/service.ts";
import { ProviderError, type ChatMessage, type Usage } from "./providers/types.ts";
import type { ModelRef, SettingsStore } from "./settings.ts";
import { type CapStatus, estimateTokens, type UsageStore } from "./usage.ts";

export type ChatDeps = {
  library: Library;
  messages: Messages;
  providers: Providers;
  settings: SettingsStore;
  usage: UsageStore;
  // Extra system context for a chat: its study brief and, in a lesson chat, the lesson's items (F-105).
  context?: (chat: Chat) => string;
  // After each reply in a lesson chat: records which items the exchange taught or checked; true when any moved.
  progress?: (chat: Chat, exchange: ChatMessage[], messageId: string) => Promise<boolean>;
  log?: (msg: string) => void;
};

export type Meter = { input: number; output: number; context: number; contextWindow: number | null };

export type TurnEvent =
  | { type: "start"; user: Message; assistant: Message }
  | { type: "delta"; text: string }
  | { type: "model"; provider: string; model: string }
  | { type: "done"; message: Message; meter: Meter; cap: CapStatus }
  | { type: "error"; message: Message; error: string }
  | { type: "title"; title: string }
  | { type: "progress" };

const NAMER_EXCERPT = 1500;

export const meterFor = (deps: ChatDeps, chat: Chat): Meter => ({
  ...deps.usage.chatMeter(chat.id),
  contextWindow: chat.model ? deps.providers.contextWindow(chat.model) : null,
});

const sameRef = (a: ModelRef, b: ModelRef) => a.provider === b.provider && a.id === b.id && (a.key ?? "") === (b.key ?? "");

// Validates a turn before any streaming starts, so problems surface as plain HTTP errors.
// The chat's model comes first, then the strong slot's chain, each model tried on every key of its provider,
// leaving out providers that are capped.
export function prepareTurn(deps: ChatDeps, chatId: string, text: string, model?: ModelRef) {
  const chat = deps.library.getChat(chatId);
  const content = text.trim();
  if (!content) throw new AppError(400, "empty_message", "Type a message first.");
  const { models, fallbacks, caps } = deps.settings.get();
  const ref = model ?? chat.model ?? models.strong;
  if (!ref) throw new AppError(400, "no_model", "Pick a model in Settings first.");
  const chain = deps.providers.withKeys([ref, ...(models.strong ? [models.strong, ...fallbacks.strong] : [])])
    .filter((r) => deps.usage.capStatus(caps, r.provider).state !== "blocked");
  if (!chain.length) {
    throw new AppError(429, "cap_reached", "You've reached a token cap. Raise it in Settings or wait for it to reset.", deps.usage.capStatus(caps, ref.provider));
  }
  return { chat, content, ref, chain };
}

// Rate limits, outages and quota errors hand the turn to the next model, but only before any text arrived.
const fallsBack = (err: unknown) => err instanceof ProviderError && (err.status === 429 || err.status >= 500 || err.status === 0);

export async function* streamTurn(
  deps: ChatDeps,
  { chat, content, ref, chain }: ReturnType<typeof prepareTurn>,
  signal: AbortSignal,
): AsyncGenerator<TurnEvent> {
  const { library, messages, providers, usage } = deps;
  // Finished turns only: a question whose reply failed was asked again, so it's left out too.
  const earlier = messages.list(chat.id);
  const history: ChatMessage[] = earlier
    .filter((m, i) => m.status === "done" && m.content && !(m.role === "user" && earlier[i + 1] && earlier[i + 1]!.status !== "done"))
    .map((m) => ({ role: m.role, content: m.content }));
  history.push({ role: "user", content });
  const system = [ASK_SYSTEM, deps.context?.(chat)].filter(Boolean).join("\n\n");

  const user = messages.add({ chatId: chat.id, role: "user", content, status: "done" });
  const assistant = messages.add({ chatId: chat.id, role: "assistant", content: "", status: "streaming", provider: chain[0]!.provider, model: chain[0]!.id });
  const current = chat.model && sameRef(chat.model, ref) ? chat : library.updateChat(chat.id, { model: ref });
  library.touchChat(chat.id);
  yield { type: "start", user, assistant };

  let reply = "";
  let reported: Usage | null = null;
  let answering = chain[0]!;
  const record = () => usage.record({
    provider: answering.provider, model: answering.id, role: "chat", chatId: chat.id, folderId: chat.folderId,
    usage: reported ?? {
      input: estimateTokens(system + history.map((m) => m.content).join("")),
      output: estimateTokens(reply), cached: 0, reasoning: 0,
    },
    estimated: !reported,
  });

  try {
    for (let i = 0; ; i++) {
      answering = chain[i]!;
      if (i > 0) {
        messages.setModel(assistant.id, answering.provider, answering.id);
        yield { type: "model", provider: answering.provider, model: answering.id };
      }
      try {
        for await (const event of providers.stream(answering, { system, messages: history, signal })) {
          if (event.type === "text") {
            reply += event.text;
            yield { type: "delta", text: event.text };
          } else {
            reported = event.usage;
          }
        }
        break;
      } catch (err) {
        if (reply || signal.aborted || !fallsBack(err) || i === chain.length - 1) throw err;
        deps.log?.(`${providers.describe(answering)} failed (${err instanceof Error ? err.message : err}); trying ${providers.describe(chain[i + 1]!)}`);
      }
    }
  } catch (err) {
    if (signal.aborted) {
      // The learner stopped the reply: keep what arrived and count it, since the provider billed it.
      messages.finish(assistant.id, reply, "aborted");
      record();
      return;
    }
    const error = err instanceof Error ? err.message : String(err);
    messages.finish(assistant.id, reply, "error", error);
    if (reply) record();
    yield { type: "error", message: { ...assistant, provider: answering.provider, model: answering.id, content: reply, status: "error", error }, error };
    return;
  }

  messages.finish(assistant.id, reply, "done");
  record();
  yield {
    type: "done",
    message: { ...assistant, provider: answering.provider, model: answering.id, content: reply, status: "done" },
    meter: meterFor(deps, current),
    cap: usage.capStatus(deps.settings.get().caps, answering.provider),
  };

  if (chat.lessonId && deps.progress) {
    const moved = await deps.progress(chat, [...history.slice(-2), { role: "assistant", content: reply }], assistant.id).catch((err) => {
      deps.log?.(`Lesson progress failed: ${err instanceof Error ? err.message : err}`);
      return false;
    });
    if (moved) yield { type: "progress" };
  }

  if (chat.titleSource === "default") {
    const title = await nameChat(deps, chat, content, reply, answering).catch((err) => {
      deps.log?.(`Chat naming failed: ${err instanceof Error ? err.message : err}`);
      return null;
    });
    if (title && library.setAutoTitle(chat.id, title)) yield { type: "title", title };
  }
}

// Auto-naming (F-005) on the cheap slot; skipped when its provider is capped.
async function nameChat(deps: ChatDeps, chat: Chat, question: string, answer: string, fallback: ModelRef) {
  const ref = deps.settings.get().models.cheap ?? fallback;
  if (deps.usage.capStatus(deps.settings.get().caps, ref.provider).state === "blocked") return null;
  let text = "";
  let reported: Usage | null = null;
  const prompt = `Learner: ${question.slice(0, NAMER_EXCERPT)}\n\nAssistant: ${answer.slice(0, NAMER_EXCERPT)}`;
  for await (const event of deps.providers.stream(ref, { system: NAMER_SYSTEM, messages: [{ role: "user", content: prompt }], maxTokens: 256 })) {
    if (event.type === "text") text += event.text;
    else reported = event.usage;
  }
  deps.usage.record({
    provider: ref.provider, model: ref.id, role: "namer", chatId: chat.id, folderId: chat.folderId,
    usage: reported ?? { input: estimateTokens(NAMER_SYSTEM + prompt), output: estimateTokens(text), cached: 0, reasoning: 0 },
    estimated: !reported,
  });
  return cleanTitle(text);
}

export function cleanTitle(raw: string): string | null {
  const line = raw.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const title = line
    .replace(/^#+\s*/, "")
    .replace(/^(title:\s*)/i, "")
    .replace(/^["'“‘*_`]+|["'”’*_`]+$/g, "")
    .replace(/[.!?:;,]+$/, "")
    .trim()
    .slice(0, 80);
  return title || null;
}
