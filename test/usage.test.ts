import { describe, expect, it } from "vitest";
import { openDb } from "../server/db.ts";
import { DEFAULT_SETTINGS, type Settings } from "../server/settings.ts";
import { createUsage } from "../server/usage.ts";

const caps = (patch: Partial<Settings["caps"]>): Settings["caps"] => ({ ...DEFAULT_SETTINGS.caps, ...patch });
const entry = (provider: string, tokens: number) => ({
  provider, model: "m", role: "chat", chatId: "c1", folderId: null, estimated: false,
  usage: { input: tokens / 2, output: tokens / 2, cached: 0, reasoning: 0 },
});

describe("caps", () => {
  it("are ok with no caps set", () => {
    const usage = createUsage(openDb(":memory:"));
    usage.record(entry("google", 1_000_000));
    expect(usage.capStatus(DEFAULT_SETTINGS.caps, "google")).toEqual({ state: "ok", checks: [] });
  });

  it("warn at the threshold and block at 100 %", () => {
    const usage = createUsage(openDb(":memory:"));
    const daily = caps({ global: { daily: 1000, monthly: null } });
    usage.record(entry("google", 700));
    expect(usage.capStatus(daily, "google").state).toBe("ok");
    usage.record(entry("google", 100));
    expect(usage.capStatus(daily, "google").state).toBe("warn");
    usage.record(entry("google", 200));
    expect(usage.capStatus(daily, "google")).toMatchObject({ state: "blocked", checks: [{ used: 1000, cap: 1000 }] });
  });

  it("apply per-provider caps only to that provider", () => {
    const usage = createUsage(openDb(":memory:"));
    const perProvider = caps({ perProvider: { openai: { daily: 500, monthly: null } } });
    usage.record(entry("openai", 500));
    expect(usage.capStatus(perProvider, "openai").state).toBe("blocked");
    expect(usage.capStatus(perProvider, "google").state).toBe("ok");
  });

  it("reset daily caps at local midnight but keep monthly totals", () => {
    let now = new Date(2026, 9, 30, 23, 0).getTime();
    const usage = createUsage(openDb(":memory:"), () => now);
    const both = caps({ global: { daily: 100, monthly: 120 } });
    usage.record(entry("google", 100));
    expect(usage.capStatus(both, "google").state).toBe("blocked");
    now = new Date(2026, 9, 31, 0, 1).getTime();
    expect(usage.capStatus(both, "google")).toMatchObject({ state: "warn", checks: [{ period: "daily", used: 0 }, { period: "monthly", used: 100 }] });
  });
});

describe("chat meter", () => {
  it("sums a chat's tokens and reports the latest prompt size", () => {
    const usage = createUsage(openDb(":memory:"));
    usage.record(entry("google", 100));
    usage.record({ ...entry("google", 300), role: "namer" });
    usage.record(entry("google", 40));
    expect(usage.chatMeter("c1")).toEqual({ input: 220, output: 220, context: 40 });
  });
});
