import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../server/db.ts";
import { createLedger } from "../server/ledger/store.ts";
import { createLibrary } from "../server/library.ts";
import type { Chunk } from "../server/materials/chunk.ts";
import { createSearch } from "../server/materials/search.ts";
import { createMaterials } from "../server/materials/store.ts";
import type { Providers } from "../server/providers/service.ts";
import { type EmbedRequest, ProviderError } from "../server/providers/types.ts";
import { createLocalModels, type LocalModels } from "../server/retrieval/local.ts";
import { createRetrieval } from "../server/retrieval/retrieve.ts";
import { cosine, createVectors } from "../server/retrieval/vectors.ts";
import { createSettings } from "../server/settings.ts";
import { createUsage } from "../server/usage.ts";

const chunk = (from: number, text: string, headings: string[] = []): Chunk =>
  ({ anchor: { unit: "page", from, to: from }, headings, text, tokens: 10, marks: [[0, from]] });

// A toy embedding: one dimension per idea, so "how variable" lands near the chunk about spread.
const IDEAS = [/mean|average|centre/i, /spread|variab|deviation/i, /sampl/i];
const toy = (text: string) => IDEAS.map((re) => (re.test(text) ? 1 : 0.05));

function setup(embeddings: "off" | "provider" = "provider", failures: Error[] = []) {
  const db = openDb(":memory:");
  const library = createLibrary(db);
  const materials = createMaterials(db, mkdtempSync(join(tmpdir(), "distil-retrieval-")));
  const settings = createSettings(db);
  const usage = createUsage(db);
  const folder = library.createFolder("Stats", null);
  const book = materials.add(folder.id, "book.pdf", new TextEncoder().encode("x"));
  materials.saveChunks(book.id, "page", 3, [
    chunk(1, "The mean is the arithmetic average of the data values.", ["Centre"]),
    chunk(2, "The standard deviation tells how far values spread out.", ["Spread"]),
    chunk(3, "A sample is a subset of the population.", ["Sampling"]),
  ]);
  const notes = materials.add(folder.id, "notes.md", new TextEncoder().encode("y"));
  materials.saveChunks(notes.id, "line", 1, [chunk(1, "Lecture: deviation from the mean, squared and averaged, is the variance.")]);
  const embedded: EmbedRequest["task"][] = [];
  const providers = {
    async embed(_ref: unknown, req: Omit<EmbedRequest, "model">) {
      const failure = failures.shift();
      if (failure) throw failure;
      embedded.push(req.task);
      return { vectors: req.texts.map(toy), tokens: 7 * req.texts.length };
    },
  } as unknown as Providers;
  if (embeddings === "provider") settings.update({ embeddings: { mode: "provider", provider: "google", id: "embed-1" } });
  const vectors = createVectors(db);
  const waits: number[] = [];
  const wait = async (ms: number) => { waits.push(ms); };
  const retrieval = createRetrieval({ db, search: createSearch(db), vectors, local: {} as LocalModels, providers, settings, usage, wait });
  return { db, folder, book, retrieval, vectors, usage, embedded, waits, ledger: createLedger(db) };
}

describe("retrieval", () => {
  it("indexes every chunk once and records the embedding tokens", async () => {
    const t = setup();
    const seen: [number, number][] = [];
    await t.retrieval.index(null, (done, total) => seen.push([done, total]));
    expect(seen.at(-1)).toEqual([4, 4]);
    expect(t.vectors.counts("google:embed-1", t.folder.id)).toEqual({ total: 4, done: 4 });
    await t.retrieval.index(null, () => {});
    expect(t.embedded).toEqual(["document"]);
    expect(t.usage.totals().today).toBe(28);
  });

  it("finds by meaning what keyword search misses, and merges both rankings", async () => {
    const t = setup();
    await t.retrieval.index(null, () => {});
    const variable = await t.retrieval.retrieve(t.folder.id, "how variable are the numbers", 2);
    expect(variable[0]!.text).toContain("spread");
    expect(variable[0]!.via).toEqual(["meaning"]);
    const both = await t.retrieval.retrieve(t.folder.id, "deviation", 4);
    expect(both[0]!.via.sort()).toEqual(["keyword", "meaning"]);
    expect(both.map((p) => p.materialName)).toContain("notes.md");
  });

  it("falls back to keyword search when meaning-based search is off", async () => {
    const t = setup("off");
    const hits = await t.retrieval.retrieve(t.folder.id, "deviation", 4);
    expect(hits.length).toBe(2);
    expect(hits.every((p) => p.via.join() === "keyword")).toBe(true);
    expect(t.embedded).toEqual([]);
  });

  it("gathers an item's own source and what every other file says about it", async () => {
    const t = setup();
    await t.retrieval.index(null, () => {});
    const item = t.ledger.addManual(t.folder.id, { type: "definition", title: "Standard deviation", statement: "How far values spread from the mean." });
    const withSource = { ...item, sources: [{ materialId: t.book.id, materialName: "book.pdf", unit: "page", loc: 2, quote: "standard deviation" }] };
    const passages = await t.retrieval.forItems(t.folder.id, [withSource], 3);
    expect(passages[0]!.via).toContain("source");
    expect(passages[0]!.loc).toBe(2);
    expect(passages.map((p) => p.materialName)).toEqual(expect.arrayContaining(["book.pdf", "notes.md"]));
  });

  it("waits out a per-minute limit and carries on, but stops when the quota is gone for hours", async () => {
    const busy = new ProviderError(429, "Tokens per minute exceeded. Please retry in 342.2ms.");
    const t = setup("provider", [busy, busy]);
    await t.retrieval.index(null, () => {});
    expect(t.waits).toEqual([2000, 4000]);
    expect(t.vectors.counts("google:embed-1", null).done).toBe(4);

    const gone = setup("provider", [new ProviderError(429, "Per day limit. Please retry in 5h2m.")]);
    await expect(gone.retrieval.index(null, () => {})).rejects.toMatchObject({ code: "quota_exhausted" });
  });

  it("compares vectors by angle", () => {
    expect(cosine([1, 0], [2, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 3])).toBeCloseTo(0);
  });
});

describe("local models", () => {
  // A fake Hugging Face: the repo's file list, then each file's bytes; failAt breaks one file's download.
  const hub = (failAt?: string) => (async (url: string) => {
    if (url.includes("/tree/main")) {
      return Response.json([
        { path: "config.json", size: 2 }, { path: "tokenizer.json", size: 3 }, { path: "README.md", size: 50 },
        { path: "onnx/model_quantized.onnx", size: 9, lfs: { size: 4 } }, { path: "onnx/model.onnx", size: 99 },
      ]);
    }
    const file = url.split("/resolve/main/")[1]!;
    if (file === failAt) return new Response("nope", { status: 500 });
    return new Response({ "config.json": "{}", "tokenizer.json": "tok", "onnx/model_quantized.onnx": "onnx" }[file] ?? "");
  }) as unknown as typeof fetch;

  it("reports the download size and fetches only the files the model needs, the model file last", async () => {
    const dir = mkdtempSync(join(tmpdir(), "distil-models-"));
    const local = createLocalModels(dir, hub());
    expect(await local.size("low")).toBe(2 + 3 + 4);
    const seen: number[] = [];
    await local.download("low", (done) => seen.push(done));
    expect(local.installed("low")).toBe(true);
    expect(seen.at(-1)).toBe(9);
    const folder = join(dir, "Xenova", "all-MiniLM-L6-v2");
    expect(readdirSync(folder).sort()).toEqual(["config.json", "onnx", "tokenizer.json"]);
    expect(readFileSync(join(folder, "onnx", "model_quantized.onnx"), "utf8")).toBe("onnx");
    local.remove("low");
    expect(existsSync(folder)).toBe(false);
  });

  it("doesn't look installed after a failed download", async () => {
    const dir = mkdtempSync(join(tmpdir(), "distil-models-"));
    const local = createLocalModels(dir, hub("onnx/model_quantized.onnx"));
    await expect(local.download("low", () => {})).rejects.toMatchObject({ code: "download_failed" });
    expect(local.installed("low")).toBe(false);
    await expect(local.embed("low", ["x"])).rejects.toMatchObject({ code: "model_missing" });
  });
});
