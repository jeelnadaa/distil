import { describe, expect, it } from "vitest";
import { type ChatDeps, cleanTitle, prepareTurn, streamTurn, type TurnEvent } from "../server/chat.ts";
import { openDb } from "../server/db.ts";
import { createLibrary } from "../server/library.ts";
import { createMessages } from "../server/messages.ts";
import type { Providers } from "../server/providers/service.ts";
import { createSettings } from "../server/settings.ts";
import { createUsage } from "../server/usage.ts";
import { scriptedAdapter } from "./helpers.ts";
import { createTutorial, GUIDE_SYSTEM, WELCOME } from "../server/tutorial/tutorial.ts";

function setup(replies: (string | Error)[]) {
  const db = openDb(":memory:");
  const adapter = scriptedAdapter(replies);
  const providers = {
    stream: (ref: { id: string }, req: object) => adapter.stream({ baseUrl: "", apiKey: null }, { ...req, model: ref.id } as never),
    contextWindow: () => 1000,
    withKeys: (chain: unknown[]) => chain,
  } as unknown as Providers;
  const deps: ChatDeps = {
    library: createLibrary(db), messages: createMessages(db), settings: createSettings(db), usage: createUsage(db), providers,
  };
  deps.settings.update({ models: { strong: { provider: "google", id: "strong" }, cheap: { provider: "google", id: "cheap" } } });
  return { deps, adapter, db };
}

async function run(deps: ChatDeps, chatId: string, text: string, signal = new AbortController().signal) {
  const events: TurnEvent[] = [];
  for await (const e of streamTurn(deps, prepareTurn(deps, chatId, text), signal)) events.push(e);
  return events;
}

describe("a chat turn", () => {
  it("streams the reply, saves both messages, records usage and names the chat", async () => {
    const { deps, adapter } = setup(["Bayes relates priors to posteriors.", "Bayes' Theorem Basics"]);
    const chat = deps.library.createChat(null);
    const events = await run(deps, chat.id, "What is Bayes?");

    expect(events.filter((e) => e.type !== "delta").map((e) => e.type)).toEqual(["start", "done", "title"]);
    expect(events.map((e) => (e.type === "delta" ? e.text : "")).join("")).toBe("Bayes relates priors to posteriors.");
    expect(events.at(-1)).toEqual({ type: "title", title: "Bayes' Theorem Basics" });
    expect(deps.messages.list(chat.id).map((m) => [m.role, m.status, m.content])).toEqual([
      ["user", "done", "What is Bayes?"],
      ["assistant", "done", "Bayes relates priors to posteriors."],
    ]);
    expect(deps.library.getChat(chat.id)).toMatchObject({ titleSource: "auto", model: { provider: "google", id: "strong" } });
    // The namer ran on the cheap slot and both calls were counted.
    expect((adapter.requests[1] as { model: string }).model).toBe("cheap");
    expect(deps.usage.chatMeter(chat.id)).toMatchObject({ input: 20, context: 10 + 35 });
  });

  it("sends earlier finished messages as history and doesn't rename a named chat", async () => {
    const { deps, adapter } = setup(["One.", "Title", "Two."]);
    const chat = deps.library.createChat(null);
    await run(deps, chat.id, "First?");
    await run(deps, chat.id, "Second?");
    const last = adapter.requests.at(-1) as { messages: { content: string }[] };
    expect(last.messages.map((m) => m.content)).toEqual(["First?", "One.", "Second?"]);
    expect(adapter.requests).toHaveLength(3);
  });

  it("leaves a question whose reply failed out of the history", async () => {
    const { deps, adapter } = setup([new Error("busy"), "One.", "Title", "Two."]);
    const chat = deps.library.createChat(null);
    await run(deps, chat.id, "First?");
    await run(deps, chat.id, "First?");
    await run(deps, chat.id, "Second?");
    const last = adapter.requests.at(-1) as { messages: { content: string }[] };
    expect(last.messages.map((m) => m.content)).toEqual(["First?", "One.", "Second?"]);
  });

  it("is refused before streaming when a cap is reached", async () => {
    const { deps } = setup([]);
    deps.settings.update({ caps: { warnAt: 0.8, global: { daily: 100, monthly: null }, perProvider: {} } });
    deps.usage.record({ provider: "google", model: "x", role: "chat", chatId: null, folderId: null, estimated: false, usage: { input: 60, output: 40, cached: 0, reasoning: 0 } });
    const chat = deps.library.createChat(null);
    expect(() => prepareTurn(deps, chat.id, "Hi")).toThrow(expect.objectContaining({ code: "cap_reached", status: 429 }));
  });

  it("needs a model and a non-empty message", () => {
    const { deps } = setup([]);
    const chat = deps.library.createChat(null);
    expect(() => prepareTurn(deps, chat.id, "   ")).toThrow(expect.objectContaining({ code: "empty_message" }));
    deps.settings.update({ models: { strong: null, cheap: null } });
    expect(() => prepareTurn(deps, chat.id, "Hi")).toThrow(expect.objectContaining({ code: "no_model" }));
  });

  it("keeps a partial reply when stopped, and still counts its tokens", async () => {
    const { deps } = setup(["a b c d e f"]);
    const chat = deps.library.createChat(null);
    const controller = new AbortController();
    const events: TurnEvent[] = [];
    for await (const e of streamTurn(deps, prepareTurn(deps, chat.id, "Go"), controller.signal)) {
      events.push(e);
      if (events.length === 3) controller.abort();
    }
    expect(events.map((e) => e.type)).toEqual(["start", "delta", "delta"]);
    expect(deps.messages.list(chat.id)[1]).toMatchObject({ status: "aborted", content: "a b " });
    expect(deps.usage.chatMeter(chat.id).output).toBeGreaterThan(0);
  });

  it("reports provider errors on the message instead of throwing", async () => {
    const { deps } = setup([new Error("Provider error 500.")]);
    const chat = deps.library.createChat(null);
    const events = await run(deps, chat.id, "Hi");
    expect(events.at(-1)).toMatchObject({ type: "error", error: "Provider error 500." });
    expect(deps.messages.list(chat.id)[1]).toMatchObject({ status: "error", error: "Provider error 500." });
  });
});

describe("cleanTitle", () => {
  it.each([
    ['"Fourier Series Basics."', "Fourier Series Basics"],
    ["Title: Laplace Transforms\nmore text", "Laplace Transforms"],
    ["## **Gibbs Phenomenon**", "Gibbs Phenomenon"],
    ["   ", null],
  ])("%j → %j", (raw, expected) => expect(cleanTitle(raw)).toBe(expected));
});

describe("tutorial chat", () => {
  it("is added once, answers from the guide on the cheap model, and starts the history with the learner", async () => {
    const { deps, adapter, db } = setup(["Open **Settings › Limits**."]);
    const tutorial = createTutorial({ db, library: deps.library, messages: deps.messages });
    tutorial.addOnce();
    const chat = tutorial.find()!;
    expect(chat).toMatchObject({ mode: "guide", title: "How to use Distil", titleSource: "manual" });
    expect(deps.messages.list(chat.id)[0]).toMatchObject({ role: "assistant", content: WELCOME });

    await run(deps, chat.id, "How do I cap tokens?");
    const req = adapter.requests[0] as { model: string; system: string; messages: { role: string }[] };
    expect(req.model).toBe("cheap");
    expect(req.system).toBe(GUIDE_SYSTEM);
    expect(req.messages.map((m) => m.role)).toEqual(["user"]);

    deps.library.deleteChat(chat.id);
    tutorial.addOnce();
    expect(tutorial.find()).toBeNull();
    expect(tutorial.open().id).not.toBe(chat.id);
  });
});
