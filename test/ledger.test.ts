import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../server/db.ts";
import { createJobs } from "../server/jobs.ts";
import { estimateExtraction, extractLabel, registerExtraction } from "../server/ledger/extract.ts";
import { makePdf } from "./fixtures.ts";
import { createLedger, locate } from "../server/ledger/store.ts";
import { createLibrary } from "../server/library.ts";
import { parseJsonReply } from "../server/llm.ts";
import { registerIngest } from "../server/materials/ingest.ts";
import { createMaterials } from "../server/materials/store.ts";
import { AUDIT_SYSTEM, EXTRACT_SYSTEM, MERGE_SYSTEM } from "../server/prompts.ts";
import type { Providers } from "../server/providers/service.ts";
import { createSettings } from "../server/settings.ts";
import { createUsage } from "../server/usage.ts";

type Request = { system: string; messages: { role: string; content: string; images?: { mime: string }[] }[] };
type Reply = (req: Request, prompt: string) => string;

// A fake model that answers by agent role, so parallel calls don't depend on ordering.
function setup(replies: { extract: Reply; audit?: Reply; merge?: Reply }) {
  const db = openDb(":memory:");
  const library = createLibrary(db);
  const settings = createSettings(db);
  const usage = createUsage(db);
  const materials = createMaterials(db, mkdtempSync(join(tmpdir(), "distil-ledger-")));
  const ledger = createLedger(db);
  const jobs = createJobs(db, { concurrency: 1 });
  const calls: { role: string; model: string; prompt: string; images: string[] }[] = [];
  const providers = {
    async *stream(ref: { id: string }, req: Request) {
      const prompt = req.messages.at(-1)!.content;
      const role = req.system === EXTRACT_SYSTEM ? "extract" : req.system === AUDIT_SYSTEM ? "audit" : req.system === MERGE_SYSTEM ? "merge" : "other";
      calls.push({ role, model: ref.id, prompt, images: (req.messages.at(-1)!.images ?? []).map((i) => i.mime) });
      const reply = role === "extract" ? replies.extract(req, prompt)
        : role === "audit" ? (replies.audit ?? (() => '{"missed":[]}'))(req, prompt)
        : (replies.merge ?? (() => '{"merges":[]}'))(req, prompt);
      yield { type: "text" as const, text: reply };
      yield { type: "usage" as const, usage: { input: 100, output: 20, cached: 0, reasoning: 0 } };
    },
    withKeys: (chain: unknown[]) => chain,
  } as unknown as Providers;
  settings.update({ models: { strong: { provider: "google", id: "strong" }, cheap: { provider: "google", id: "cheap" } } });
  registerIngest(jobs, materials, ledger);
  registerExtraction(jobs, { providers, settings, usage, materials, ledger });
  const folder = library.createFolder("Signals", null);

  const addMaterial = async (name: string, content: string | Uint8Array) => {
    const material = materials.add(folder.id, name, typeof content === "string" ? new TextEncoder().encode(content) : content);
    jobs.enqueue("parse", name, { folderId: folder.id, materialId: material.id });
    await jobs.idle();
    return material;
  };
  const extract = async (materialId: string, strategy = "balanced", range: { from?: number; to?: number } = {}) => {
    const job = jobs.enqueue("extract", "x", { folderId: folder.id, materialId, params: { strategy, ...range } });
    await jobs.idle();
    return jobs.get(job.id);
  };
  return { db, materials, ledger, usage, folder, calls, addMaterial, extract };
}

const item = (title: string, statement: string, quote: string, type = "concept") => ({ type, title, statement, quote });
const json = (value: unknown) => JSON.stringify(value);
const NOTES = "# Sampling\n\nThe Nyquist rate is twice the highest frequency in the signal.\n\nAliasing folds high frequencies onto low ones.";

describe("locate", () => {
  it("maps a quote to the location where it starts, ignoring case and spacing", () => {
    const chunk = { text: "Page one text.\n\nSecond page says   Hello World here.", marks: [[0, 1], [16, 2]] as [number, number][], from: 1 };
    expect(locate(chunk, "page one")).toBe(1);
    expect(locate(chunk, "says hello\nworld")).toBe(2);
    expect(locate(chunk, "not in the text")).toBe(1);
  });
});

describe("parseJsonReply", () => {
  it("finds the JSON object inside a fence or a sentence", () => {
    expect(parseJsonReply('Sure:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonReply('Here you go {"a":[1,2]} done')).toEqual({ a: [1, 2] });
    expect(() => parseJsonReply("no json")).toThrow();
  });
});

describe("extraction", () => {
  it("extracts with the cheap model, audits with the strong one until clean, and records usage by role", async () => {
    let audits = 0;
    const t = setup({
      extract: () => json({ items: [item("Nyquist rate", "Twice the highest frequency.", "Nyquist rate is twice", "definition")] }),
      audit: () => json({ missed: audits++ === 0 ? [item("Aliasing", "High frequencies fold onto low ones.", "Aliasing folds high")] : [] }),
    });
    const material = await t.addMaterial("notes.md", NOTES);
    const job = await t.extract(material.id);

    expect(job).toMatchObject({ status: "done", done: job.total });
    const items = t.ledger.list(t.folder.id);
    expect(items.map((i) => [i.title, i.type, i.origin])).toEqual([["Nyquist rate", "definition", "extracted"], ["Aliasing", "concept", "audit"]]);
    expect(items[0]!.sources[0]).toMatchObject({ materialId: material.id, materialName: "notes.md", quote: "Nyquist rate is twice" });
    expect(t.calls.map((c) => `${c.role}:${c.model}`)).toEqual(["extract:cheap", "audit:strong", "audit:strong"]);
    // The second audit sees what the first one added.
    expect(t.calls[2]!.prompt).toContain("[concept] Aliasing");
    expect(t.materials.chunks(material.id).every((c) => c.extracted && c.audited)).toBe(true);
    const roles = (t.db.prepare("SELECT role, COUNT(*) AS n FROM usage GROUP BY role ORDER BY role").all() as { role: string; n: number }[]);
    expect(roles.map((r) => `${r.role}:${r.n}`)).toEqual(["auditor:2", "extractor:1"]);
  });

  it("stops auditing after the round limit even if the model keeps finding things", async () => {
    let n = 0;
    const t = setup({ extract: () => json({ items: [] }), audit: () => json({ missed: [item(`Extra ${n++}`, "More.", "")] }) });
    const material = await t.addMaterial("notes.md", NOTES);
    await t.extract(material.id);
    expect(t.calls.filter((c) => c.role === "audit")).toHaveLength(2);
    expect(t.ledger.list(t.folder.id)).toHaveLength(2);
  });

  it("uses the strong model for everything in thorough mode", async () => {
    const t = setup({ extract: () => json({ items: [] }) });
    const material = await t.addMaterial("notes.md", NOTES);
    await t.extract(material.id, "thorough");
    expect(new Set(t.calls.map((c) => c.model))).toEqual(new Set(["strong"]));
  });

  it("uses the cheap model for everything in economy mode, audits included", async () => {
    const t = setup({ extract: () => json({ items: [item("Nyquist rate", "Twice the highest frequency.", "Nyquist rate")] }) });
    const material = await t.addMaterial("notes.md", NOTES);
    await t.extract(material.id, "economy");
    expect(t.calls.some((c) => c.role === "audit")).toBe(true);
    expect(new Set(t.calls.map((c) => c.model))).toEqual(new Set(["cheap"]));
  });

  it("retries once with the validation error, then fails the job clearly", async () => {
    let tries = 0;
    const t = setup({ extract: () => (tries++ === 0 ? "not json" : json({ items: [item("Nyquist rate", "x", "")] })) });
    const material = await t.addMaterial("notes.md", NOTES);
    expect((await t.extract(material.id)).status).toBe("done");
    expect(t.calls[1]!.prompt).toContain("could not be used");

    const bad = setup({ extract: () => "still not json" });
    const other = await bad.addMaterial("notes.md", NOTES);
    const job = await bad.extract(other.id);
    expect(job.status).toBe("error");
    expect(job.error).toMatch(/expected format twice/);
  });

  it("resumes without redoing finished chunks", async () => {
    const t = setup({ extract: () => json({ items: [item("Nyquist rate", "x", "")] }) });
    const material = await t.addMaterial("notes.md", NOTES);
    await t.extract(material.id);
    const before = t.calls.length;
    await t.extract(material.id);
    expect(t.calls.slice(before).map((c) => c.role)).toEqual([]);
    expect(t.ledger.list(t.folder.id)).toHaveLength(1);
  });

  it("finishes a chunk whose audit rounds were used up before it was marked done", async () => {
    const t = setup({ extract: () => json({ items: [item("Nyquist rate", "x", "")] }) });
    const material = await t.addMaterial("notes.md", NOTES);
    await t.extract(material.id);
    t.db.prepare("UPDATE chunks SET audit_rounds = 3, audit_done = 0 WHERE material_id = ?").run(material.id);
    const before = t.calls.length;
    expect((await t.extract(material.id)).status).toBe("done");
    expect(t.calls.slice(before).filter((c) => c.role === "audit")).toEqual([]);
    expect(t.materials.get(material.id).distilled).toBe(1);
  });

  it("merges duplicates across materials, keeping every source", async () => {
    const t = setup({
      extract: (_req, prompt) => json({ items: [item(prompt.includes("slides.md") ? "Nyquist rate rule" : "Nyquist rate", "Twice the highest frequency.", "Nyquist rate")] }),
      merge: (_req, prompt) => {
        const ids = [...prompt.matchAll(/^(i\d+) /gm)].map((m) => m[1]!);
        return json({ merges: ids.length > 1 ? [{ keep: ids[0], drop: ids.slice(1), title: "Nyquist rate", statement: "Sample at twice the top frequency." }] : [] });
      },
    });
    const notes = await t.addMaterial("notes.md", NOTES);
    await t.extract(notes.id);
    const slides = await t.addMaterial("slides.md", NOTES.replace("Sampling", "Sampling slides"));
    await t.extract(slides.id);

    const items = t.ledger.list(t.folder.id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Nyquist rate", statement: "Sample at twice the top frequency." });
    expect(items[0]!.sources.map((s) => s.materialName)).toEqual(["notes.md", "slides.md"]);
    // Items that were already judged together aren't sent again.
    const merges = t.calls.filter((c) => c.role === "merge").length;
    await t.extract(slides.id);
    expect(t.calls.filter((c) => c.role === "merge").length).toBe(merges);
  });

  it("removes extracted items with their material but keeps manual ones", async () => {
    const t = setup({ extract: () => json({ items: [item("Nyquist rate", "x", "")] }) });
    const material = await t.addMaterial("notes.md", NOTES);
    await t.extract(material.id);
    t.ledger.addManual(t.folder.id, { type: "fact", title: "Exam is open book", statement: "" });
    t.materials.remove(material.id);
    t.ledger.removeOrphans();
    expect(t.ledger.list(t.folder.id).map((i) => i.title)).toEqual(["Exam is open book"]);
  });

  it("estimates only the work that is left", async () => {
    const t = setup({ extract: () => json({ items: [] }) });
    const material = await t.addMaterial("notes.md", NOTES);
    const chunks = t.materials.chunks(material.id);
    const balanced = estimateExtraction(chunks, "balanced");
    expect(balanced.cheap.input).toBeGreaterThan(0);
    expect(balanced.strong.input).toBeGreaterThan(0);
    expect(estimateExtraction(chunks, "thorough").cheap.input).toBe(0);
    expect(estimateExtraction(chunks, "economy").strong.input).toBe(0);
    await t.extract(material.id);
    expect(t.materials.chunks(material.id).filter((c) => !c.extracted || !c.audited)).toHaveLength(0);
  });

  it("reads an image material by sending the picture itself", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const t = setup({ extract: () => json({ items: [item("Bayes' theorem", "$P(A|B) = P(B|A)P(A)/P(B)$", "", "formula")] }) });
    const material = await t.addMaterial("whiteboard.png", png);
    expect(t.materials.get(material.id)).toMatchObject({ kind: "image", visual: [1], chunks: 1 });
    expect(t.materials.read(material.id).type).toBe("image/png");
    await t.extract(material.id);
    expect(t.calls.filter((c) => c.role !== "merge").map((c) => [c.role, c.images])).toEqual([["extract", ["image/png"]], ["audit", ["image/png"]]]);
    expect(t.calls[0]!.prompt).toContain("Attached: images of page 1");
    expect(t.ledger.list(t.folder.id)[0]).toMatchObject({ type: "formula", sources: [expect.objectContaining({ loc: 1 })] });
  });

  it("distils only the chunks in a page range, and the rest later", async () => {
    const t = setup({ extract: (_req, prompt) => json({ items: [item(`Item from ${prompt.match(/Location: (.*)/)![1]}`, "x", "")] }) });
    // About one chunk per page: 40 short lines of ~80 characters each.
    const pages = Array.from({ length: 6 }, (_, i) => Array.from({ length: 40 }, (_, j) => `Page ${i + 1} line ${j + 1}: a sentence long enough to fill most of one printed line.`));
    const material = await t.addMaterial("book.pdf", makePdf(pages));
    const chunks = t.materials.chunks(material.id);
    expect(chunks.length).toBeGreaterThan(3);
    await t.extract(material.id, "balanced", { from: 1, to: 2 });
    const touched = t.materials.chunks(material.id).filter((c) => c.extracted);
    expect(touched.length).toBeGreaterThan(0);
    expect(touched.every((c) => c.from <= 2)).toBe(true);
    expect(t.materials.chunks(material.id).some((c) => !c.extracted)).toBe(true);
    await t.extract(material.id);
    expect(t.materials.chunks(material.id).every((c) => c.extracted && c.audited)).toBe(true);
  });
});

describe("re-import", () => {
  // Sections long enough that each is its own chunk.
  const section = (name: string) => `# ${name}\n\n${`${name} is described in detail here, sentence after sentence. `.repeat(70)}`;
  const doc = (...names: string[]) => names.map(section).join("\n\n");

  it("keeps unchanged sections and their items, removes items of removed text and reports the diff", async () => {
    const t = setup({ extract: (_req, prompt) => json({ items: [item(prompt.match(/# (\w+)/)?.[1] ?? prompt.match(/Section: (\w+)/)![1]!, "s", "described in detail")] }) });
    const material = await t.addMaterial("notes.md", doc("Alpha", "Beta", "Gamma"));
    expect(t.materials.chunks(material.id)).toHaveLength(3);
    await t.extract(material.id);
    const before = t.ledger.list(t.folder.id);
    expect(before.map((i) => i.title).sort()).toEqual(["Alpha", "Beta", "Gamma"]);
    const loc = (list: typeof before, title: string) => list.find((i) => i.title === title)!.sources[0]!.loc;
    const alphaLoc = loc(before, "Alpha");
    const gammaLoc = loc(before, "Gamma");

    // The new version adds a section before the rest, drops Beta and keeps Alpha and Gamma word for word.
    t.materials.replace(material.id, "notes v2.md", new TextEncoder().encode(doc("Intro", "Alpha", "Gamma")));
    t.calls.length = 0;
    const jobs = createJobs(t.db, { concurrency: 1 });
    registerIngest(jobs, t.materials, t.ledger);
    jobs.enqueue("parse", "x", { folderId: t.folder.id, materialId: material.id, params: { reimport: true } });
    await jobs.idle();

    const after = t.materials.get(material.id);
    expect(after).toMatchObject({ name: "notes v2.md", status: "ready", chunks: 3, distilled: 2 });
    expect(after.reimport).toMatchObject({ kept: 2, added: 1, removed: 1, items: [{ type: "concept", title: "Beta" }] });
    const items = t.ledger.list(t.folder.id);
    expect(items.map((i) => i.title).sort()).toEqual(["Alpha", "Gamma"]);
    // Alpha moved down below Intro and its anchor moved with it; Gamma stayed on the same line, as Intro is as long as Beta was.
    expect(loc(items, "Alpha")).toBe(alphaLoc + 4);
    expect(loc(items, "Gamma")).toBe(gammaLoc);

    // Only the new section is mined.
    await t.extract(material.id);
    expect(t.calls.filter((c) => c.role === "extract")).toHaveLength(1);
    expect(t.ledger.list(t.folder.id).map((i) => i.title).sort()).toEqual(["Alpha", "Gamma", "Intro"]);
    expect(() => t.materials.replace(material.id, "same.md", new TextEncoder().encode(doc("Intro", "Alpha", "Gamma")))).toThrow(/same file/);
  });
});

describe("extractLabel", () => {
  it("says which range a job covers", () => {
    expect(extractLabel("book.pdf", "page")).toBe("Distilling book.pdf");
    expect(extractLabel("book.pdf", "page", { from: 17, to: 176 })).toBe("Distilling book.pdf · pages 17–176");
    expect(extractLabel("deck.pptx", "slide", { from: 4, to: 4 })).toBe("Distilling deck.pptx · slide 4");
    expect(extractLabel("notes.md", "line", { from: 30 })).toBe("Distilling notes.md · lines 30–end");
  });
});
