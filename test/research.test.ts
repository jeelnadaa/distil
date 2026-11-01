import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../server/db.ts";
import { createJobs } from "../server/jobs.ts";
import { createLibrary } from "../server/library.ts";
import { createMaterials } from "../server/materials/store.ts";
import type { Providers } from "../server/providers/service.ts";
import { createResearcher } from "../server/research/researcher.ts";
import { searchSecret, webSearch } from "../server/research/search.ts";
import { createSecrets } from "../server/secrets.ts";
import { createSettings } from "../server/settings.ts";
import { createUsage } from "../server/usage.ts";

const HOUR = 3_600_000;
type Request = { system: string; messages: { content: string }[] };

const fakeFetch = (calls: string[]) => (async (url: string | URL, init?: RequestInit) => {
  calls.push(`${url} ${init?.body ?? ""}`);
  const tavily = String(url).includes("tavily");
  const q = tavily ? JSON.parse(String(init!.body)).query : new URL(String(url)).searchParams.get("q");
  const results = [1, 2].map((i) => ({ title: `${q} ${i}`, url: `https://example.org/${encodeURIComponent(q!)}/${i}`, [tavily ? "content" : "description"]: `About <b>${q}</b>, part ${i}.` }));
  return new Response(JSON.stringify(tavily ? { results } : { web: { results } }), { status: 200 });
}) as typeof fetch;

describe("usage dashboard", () => {
  it("buckets tokens by day, breaks them down, and exports every request as CSV", () => {
    const db = openDb(":memory:");
    let t = new Date(2026, 10, 1, 15).getTime();
    const usage = createUsage(db, () => t);
    const folder = createLibrary(db).createFolder("Stats, \"intro\"", null);
    const entry = (model: string, input: number, output: number) => ({ provider: "google", model, role: "chat", chatId: null, folderId: folder.id, usage: { input, output, cached: 0, reasoning: 0 }, estimated: false });
    usage.record(entry("flash", 100, 50));
    t -= 2 * 24 * HOUR;
    usage.record(entry("lite", 10, 5));
    t += 2 * 24 * HOUR;

    const week = usage.report("week");
    expect(week.series).toHaveLength(7);
    expect(week.series.at(-1)).toMatchObject({ input: 100, output: 50 });
    expect(week.series.at(-3)).toMatchObject({ input: 10, output: 5 });
    expect(week.total).toEqual({ input: 110, output: 55 });
    expect(week.by.model.map((r) => r.key)).toEqual(["flash", "lite"]);
    expect(week.by.folder[0]).toMatchObject({ label: "Stats, \"intro\"", requests: 2 });
    expect(usage.report("day")).toMatchObject({ total: { input: 100, output: 50 } });
    expect(usage.report("day").series[15]).toMatchObject({ input: 100 });

    const csv = usage.csv(week.since).trim().split("\n");
    expect(csv).toHaveLength(3);
    expect(csv[1]).toContain(",google,lite,chat,\"Stats, \"\"intro\"\"\",,10,5,0,0,0");
  });
});

describe("web search", () => {
  it("reads Tavily and Brave results the same way, with tags stripped", async () => {
    const calls: string[] = [];
    const t = await webSearch("tavily", "tvly-test", "fourier", { count: 2, fetch: fakeFetch(calls) });
    const b = await webSearch("brave", "brave-test", "fourier", { count: 2, fetch: fakeFetch(calls) });
    expect(t).toEqual(b);
    expect(b[0]).toEqual({ title: "fourier 1", url: "https://example.org/fourier/1", snippet: "About fourier, part 1." });
    const refused = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    await expect(webSearch("brave", "bad", "x", { fetch: refused })).rejects.toThrow(/key was refused/);
  });
});

describe("researcher", () => {
  function setup(withSearch: boolean) {
    const db = openDb(":memory:");
    const settings = createSettings(db);
    settings.update({ models: { strong: { provider: "google", id: "strong" }, cheap: null } });
    const secrets = createSecrets(join(mkdtempSync(join(tmpdir(), "distil-research-")), "secrets.json"));
    if (withSearch) {
      secrets.add(searchSecret("tavily"), "tvly-test");
      settings.update({ webSearch: "tavily" });
    }
    const requests: Request[] = [];
    const providers = {
      async *stream(_ref: unknown, req: Request) {
        requests.push(req);
        const text = req.system.startsWith("You plan")
          ? `{"title": "Fourier analysis", "sections": [{"title": "Periodic signals", "covers": "period, frequency", "query": "periodic signals"}, {"title": "Fourier series", "query": "fourier series"}]}`
          : `## ${req.messages[0]!.content.match(/Write section \d+: (.*)/)![1]}\n\nBody [1].`;
        yield { type: "text" as const, text };
        yield { type: "usage" as const, usage: { input: 10, output: 10, cached: 0, reasoning: 0 } };
      },
      describe: () => "fake",
      withKeys: (chain: unknown[]) => chain,
    } as unknown as Providers;
    const jobs = createJobs(db);
    const materials = createMaterials(db, mkdtempSync(join(tmpdir(), "distil-mat-")));
    const calls: string[] = [];
    const researcher = createResearcher({ providers, settings, usage: createUsage(db), jobs, materials, secrets, fetch: fakeFetch(calls) });
    const folder = createLibrary(db).createFolder("Signals", null);
    const until = async (ok: () => boolean) => {
      for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 5));
      expect(ok()).toBe(true);
    };
    return { materials, researcher, folder, requests, calls, until, jobs };
  }

  it("searches each section, cites the sources, and adds the syllabus as material to distil", async () => {
    const s = setup(true);
    s.researcher.start(s.folder.id, "Fourier analysis for a signals course");
    await s.until(() => s.materials.list(s.folder.id).length === 1);
    const m = s.materials.list(s.folder.id)[0]!;
    expect(m.name).toBe("Fourier analysis (researched).md");
    const text = new TextDecoder().decode(s.materials.read(m.id).bytes);
    expect(text).toContain("## Periodic signals\n\nBody [1].");
    expect(text).toContain("## Sources\n\n1. [periodic signals 1](https://example.org/periodic%20signals/1)");
    expect(text).toContain("4. [fourier series 2]");
    expect(s.calls).toHaveLength(2);
    expect(s.requests[1]!.messages[0]!.content).toContain("[1] periodic signals 1 (https://example.org/periodic%20signals/1)");
    expect(s.jobs.list().some((j) => j.kind === "parse" && j.materialId === m.id)).toBe(true);
  });

  it("without a search key, writes from the model and says so", async () => {
    const s = setup(false);
    s.researcher.start(s.folder.id, "Fourier analysis");
    await s.until(() => s.materials.list(s.folder.id).length === 1);
    const m = s.materials.list(s.folder.id)[0]!;
    expect(m.name).toBe("Fourier analysis (generated).md");
    expect(new TextDecoder().decode(s.materials.read(m.id).bytes)).toContain("from the model's own knowledge, with no sources");
    expect(s.calls).toHaveLength(0);
    expect(s.requests[1]!.system).toContain("You have no sources");
  });
});
