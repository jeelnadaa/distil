import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareTurn, streamTurn } from "../server/chat.ts";
import { openDb } from "../server/db.ts";
import { createLibrary } from "../server/library.ts";
import { chainFor, complete, type LlmDeps } from "../server/llm.ts";
import { createMessages } from "../server/messages.ts";
import { createProviders, type Providers } from "../server/providers/service.ts";
import { ProviderError } from "../server/providers/types.ts";
import { createSecrets } from "../server/secrets.ts";
import { createSettings, type ModelRef } from "../server/settings.ts";
import { createUsage } from "../server/usage.ts";

const A: ModelRef = { provider: "google", id: "flash" };
const B: ModelRef = { provider: "google", id: "flash", key: "work" };
const C: ModelRef = { provider: "openai", id: "mini" };

// Each model fails with its queued errors first, then answers with its own id.
function setup(failures: Record<string, ProviderError[]>) {
  const db = openDb(":memory:");
  const settings = createSettings(db);
  settings.update({ models: { strong: A, cheap: null }, fallbacks: { strong: [B, C], cheap: [] } });
  const name = (ref: ModelRef) => `${ref.id}${ref.key ? `@${ref.key}` : ""}`;
  const tried: string[] = [];
  const waits: number[] = [];
  const providers = {
    describe: name,
    contextWindow: () => null,
    async *stream(ref: ModelRef) {
      tried.push(name(ref));
      const failure = failures[name(ref)]?.shift();
      if (failure) throw failure;
      yield { type: "text" as const, text: name(ref) };
    },
  } as unknown as Providers;
  const answered: [string, boolean][] = [];
  const deps: LlmDeps = {
    providers, settings, usage: createUsage(db),
    wait: async (ms) => { waits.push(ms); },
    onAnswer: (ref, fellBack) => answered.push([name(ref), fellBack]),
  };
  const call = () => complete(deps, { slot: "strong", role: "extractor", folderId: null, system: "s", prompt: "p" });
  return { db, deps, call, tried, waits, answered };
}

const busy = () => new ProviderError(429, "Resource exhausted. Please retry in 5s.");
const outForTheDay = () => new ProviderError(429, "Quota exceeded. Please retry in 17h36m20s.");

describe("fallback chains", () => {
  it("lists the slot's model then its fallbacks; the cheap slot borrows the strong chain while unset", () => {
    const { deps } = setup({});
    expect(chainFor(deps.settings, "strong")).toEqual([A, B, C]);
    expect(chainFor(deps.settings, "cheap")).toEqual([A, B, C]);
  });

  it("hands a call to the next model without waiting when one is busy or out of quota", async () => {
    const t = setup({ flash: [outForTheDay()], "flash@work": [busy()] });
    expect(await t.call()).toBe("mini");
    expect(t.tried).toEqual(["flash", "flash@work", "mini"]);
    expect(t.waits).toEqual([]);
    expect(t.answered).toEqual([["mini", true]]);
  });

  it("waits only when every model is busy, then skips the ones out of quota", async () => {
    const t = setup({ flash: [outForTheDay()], "flash@work": [busy()], mini: [busy()] });
    expect(await t.call()).toBe("flash@work");
    expect(t.waits).toEqual([5000]);
    expect(t.tried).toEqual(["flash", "flash@work", "mini", "flash@work"]);
  });

  it("stops with one clear error once every model is out of quota", async () => {
    const t = setup({ flash: [outForTheDay()], "flash@work": [outForTheDay()], mini: [outForTheDay()] });
    await expect(t.call()).rejects.toMatchObject({ code: "quota_exhausted", message: expect.stringMatching(/^Every model/) });
  });

  it("does not fall back on errors another model wouldn't fix", async () => {
    const t = setup({ flash: [new ProviderError(400, "bad request")] });
    await expect(t.call()).rejects.toMatchObject({ status: 400 });
    expect(t.tried).toEqual(["flash"]);
  });

  it("falls back in chat before any text arrived and credits the model that answered", async () => {
    const t = setup({ flash: [busy()] });
    const library = createLibrary(t.db);
    const messages = createMessages(t.db);
    const chat = library.createChat(null);
    const deps = { ...t.deps, library, messages };
    const events = [];
    for await (const e of streamTurn(deps, prepareTurn(deps, chat.id, "hi"), new AbortController().signal)) events.push(e);
    expect(events.find((e) => e.type === "model")).toMatchObject({ provider: "google", model: "flash" });
    expect(events.find((e) => e.type === "done")).toMatchObject({ message: { content: "flash@work", status: "done" } });
    expect(library.getChat(chat.id).model).toEqual(A);
  });
});

describe("provider keys", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "distil-keys-"));

  it("moves a single saved key into a labelled list and keeps its id across restarts", () => {
    const file = join(dir(), "secrets.json");
    writeFileSync(file, JSON.stringify({ google: "AIza-test-0000000000" }));
    const first = createSecrets(file).list("google");
    expect(first).toEqual([{ id: expect.any(String), label: "Key 1", key: "AIza-test-0000000000" }]);
    expect(createSecrets(file).list("google")).toEqual(first);
    expect(JSON.parse(readFileSync(file, "utf8")).google).toEqual(first);
  });

  it("removing a key moves model choices that used it to the default key", () => {
    const db = openDb(":memory:");
    const settings = createSettings(db);
    const secrets = createSecrets(join(dir(), "secrets.json"));
    secrets.add("google", "AIza-personal-000000");
    const work = secrets.add("google", "AIza-work-0000000000", "Work");
    expect(secrets.list("google").map((k) => k.label)).toEqual(["Key 1", "Work"]);
    const providers = createProviders(settings, secrets);
    settings.update({ models: { strong: { ...A, key: work.id }, cheap: null }, fallbacks: { strong: [{ ...A, key: work.id }, C], cheap: [] } });
    expect(providers.describe({ ...A, key: work.id })).toBe("flash (Work)");
    providers.removeKey("google", work.id);
    expect(settings.get().models.strong).toEqual(A);
    expect(settings.get().fallbacks.strong).toEqual([A, C]);
    providers.removeKey("google");
    expect(settings.get().models.strong).toBeNull();
    expect(settings.get().fallbacks.strong).toEqual([C]);
  });
});
