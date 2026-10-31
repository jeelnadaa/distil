import { describe, expect, it } from "vitest";
import { openDb } from "../server/db.ts";
import { complete, type LlmDeps, retryDelay } from "../server/llm.ts";
import type { Providers } from "../server/providers/service.ts";
import { ProviderError } from "../server/providers/types.ts";
import { createSettings } from "../server/settings.ts";
import { createUsage } from "../server/usage.ts";

// A provider that fails with the given errors first, then answers "ok".
function setup(failures: ProviderError[]) {
  const db = openDb(":memory:");
  const settings = createSettings(db);
  settings.update({ models: { strong: { provider: "google", id: "flash" }, cheap: null } });
  let calls = 0;
  const waits: number[] = [];
  const providers = {
    describe: (ref: { id: string }) => ref.id,
    async *stream() {
      calls++;
      const failure = failures.shift();
      if (failure) throw failure;
      yield { type: "text" as const, text: "ok" };
      yield { type: "usage" as const, usage: { input: 5, output: 1, cached: 0, reasoning: 0 } };
    },
  } as unknown as Providers;
  const deps: LlmDeps = { providers, settings, usage: createUsage(db), wait: async (ms) => { waits.push(ms); } };
  const call = () => complete(deps, { slot: "strong", role: "extractor", folderId: null, system: "s", prompt: "p" });
  return { db, deps, call, waits, calls: () => calls };
}

describe("retryDelay", () => {
  it("reads the wait a provider asks for", () => {
    expect(retryDelay("Please retry in 17h36m20.3s.")).toBe(((17 * 60 + 36) * 60 + 20.3) * 1000);
    expect(retryDelay("Please retry in 32.5s")).toBe(32500);
    expect(retryDelay("retry after 2m")).toBe(120000);
    expect(retryDelay("quota exceeded")).toBeNull();
  });
});

describe("agent calls", () => {
  it("retries rate limits and outages with growing backoff, then succeeds", async () => {
    const t = setup([new ProviderError(503, "high demand"), new ProviderError(429, "slow down"), new ProviderError(429, "Please retry in 3s")]);
    expect(await t.call()).toBe("ok");
    expect(t.calls()).toBe(4);
    expect(t.waits[0]).toBeGreaterThanOrEqual(1500);
    expect(t.waits[1]).toBeGreaterThan(t.waits[0]! * 1.2);
    expect(t.waits[2]).toBe(3000);
    // Only the successful request is recorded: refused ones cost nothing.
    expect((t.db.prepare("SELECT COUNT(*) AS n FROM usage").get() as { n: number }).n).toBe(1);
  });

  it("stops with a clear error when the quota is gone for hours", async () => {
    const t = setup([new ProviderError(429, "Quota exceeded. Please retry in 17h36m20s.")]);
    await expect(t.call()).rejects.toMatchObject({ code: "quota_exhausted" });
    expect(t.waits).toEqual([]);
  });

  it("does not retry errors that won't go away", async () => {
    const t = setup([new ProviderError(400, "bad request")]);
    await expect(t.call()).rejects.toMatchObject({ status: 400 });
    expect(t.calls()).toBe(1);
  });

  it("gives up after five attempts", async () => {
    const t = setup(Array.from({ length: 6 }, () => new ProviderError(503, "down")));
    await expect(t.call()).rejects.toMatchObject({ status: 503 });
    expect(t.calls()).toBe(5);
  });
});
