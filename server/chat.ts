import { AppError } from "./errors.ts";
import type { Chat, Library } from "./library.ts";
import type { Message, Messages } from "./messages.ts";
import { ASK_SYSTEM, NAMER_SYSTEM } from "./prompts.ts";
import type { Providers } from "./providers/service.ts";
import type { ChatMessage, Usage } from "./providers/types.ts";
import type { ModelRef, SettingsStore } from "./settings.ts";
import { type CapStatus, estimateTokens, type UsageStore } from "./usage.ts";

export type ChatDeps = {
  library: Library;
  messages: Messages;
  providers: Providers;
  settings: SettingsStore;
  usage: UsageStore;
  log?: (msg: string) => void;
};

export type Meter = { input: number; output: number; context: number; contextWindow: number | null };

export type TurnEvent =
  | { type: "start"; user: Message; assistant: Message }
  | { type: "delta"; text: string }
  | { type: "done"; message: Message; meter: Meter; cap: CapStatus }
  | { type: "error"; message: Message; error: string }
  | { type: "title"; title: string };

const NAMER_EXCERPT = 1500;

export const meterFor = (deps: ChatDeps, chat: Chat): Meter => ({
  ...deps.usage.chatMeter(chat.id),
  contextWindow: chat.model ? deps.providers.contextWindow(chat.model) : null,
});

// Validates a turn before any streaming starts, so problems surface as plain HTTP errors.
export function prepareTurn(deps: ChatDeps, chatId: string, text: string, model?: ModelRef) {
  const chat = deps.library.getChat(chatId);
  const content = text.trim();
  if (!content) throw new AppError(400, "empty_message", "Type a message first.");
  const ref = model ?? chat.model ?? deps.settings.get().models.strong;
  if (!ref) throw new AppError(400, "no_model", "Pick a model in Settings first.");
  const cap = deps.usage.capStatus(deps.settings.get().caps, ref.provider);
  if (cap.state === "blocked") {
    throw new AppError(429, "cap_reached", "You've reached a token cap. Raise it in Settings or wait for it to reset.", cap);
  }
  return { chat, content, ref };
}

export async function* streamTurn(
  deps: ChatDeps,
  { chat, content, ref }: ReturnType<typeof prepareTurn>,
  signal: AbortSignal,
): AsyncGenerator<TurnEvent> {
  const { library, messages, providers, usage } = deps;
  const history: ChatMessage[] = messages.list(chat.id)
    .filter((m) => m.status === "done" && m.content)
    .map((m) => ({ role: m.role, content: m.content }));
  history.push({ role: "user", content });

  const user = messages.add({ chatId: chat.id, role: "user", content, status: "done" });
  const assistant = messages.add({ chatId: chat.id, role: "assistant", content: "", status: "streaming", provider: ref.provider, model: ref.id });
  const current = ref.provider === chat.model?.provider && ref.id === chat.model?.id ? chat : library.updateChat(chat.id, { model: ref });
  library.touchChat(chat.id);
  yield { type: "start", user, assistant };

  let reply = "";
  let reported: Usage | null = null;
  const record = () => usage.record({
    provider: ref.provider, model: ref.id, role: "chat", chatId: chat.id, folderId: chat.folderId,
    usage: reported ?? {
      input: estimateTokens(ASK_SYSTEM + history.map((m) => m.content).join("")),
      output: estimateTokens(reply), cached: 0, reasoning: 0,
    },
    estimated: !reported,
  });

  try {
    for await (const event of providers.stream(ref, { system: ASK_SYSTEM, messages: history, signal })) {
      if (event.type === "text") {
        reply += event.text;
        yield { type: "delta", text: event.text };
      } else {
        reported = event.usage;
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
    yield { type: "error", message: { ...assistant, content: reply, status: "error", error }, error };
    return;
  }

  messages.finish(assistant.id, reply, "done");
  record();
  yield {
    type: "done",
    message: { ...assistant, content: reply, status: "done" },
    meter: meterFor(deps, current),
    cap: usage.capStatus(deps.settings.get().caps, ref.provider),
  };

  if (chat.titleSource === "default") {
    const title = await nameChat(deps, chat, content, reply, ref).catch((err) => {
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
