import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../server/db.ts";
import { createLibrary } from "../server/library.ts";
import type { Chunk } from "../server/materials/chunk.ts";
import { createSearch, ftsTerms, HIT_END, HIT_START } from "../server/materials/search.ts";
import { createMaterials } from "../server/materials/store.ts";

const chunk = (from: number, to: number, text: string, marks: [number, number][] = [[0, from]], headings: string[] = []): Chunk =>
  ({ anchor: { unit: "page", from, to }, headings, text, tokens: 10, marks });

function setup() {
  const db = openDb(":memory:");
  const library = createLibrary(db);
  const materials = createMaterials(db, mkdtempSync(join(tmpdir(), "distil-search-")));
  const folder = library.createFolder("Stats", null);
  const other = library.createFolder("Other", null);
  const book = materials.add(folder.id, "book.pdf", new TextEncoder().encode("x"));
  const page2 = "Measures of spread.\n";
  materials.saveChunks(book.id, "page", 3, [
    chunk(1, 1, "The mean is the arithmetic average of the data values.", [[0, 1]], ["Centre"]),
    chunk(2, 3, `${page2}The standard deviation measures how far data values spread from the mean.`, [[0, 2], [page2.length, 3]], ["Spread"]),
  ]);
  const notes = materials.add(other.id, "notes.md", new TextEncoder().encode("x"));
  materials.saveChunks(notes.id, "line", 1, [chunk(1, 1, "Standard deviation, but in another folder.")]);
  return { db, materials, search: createSearch(db), folder, book };
}

describe("keyword search", () => {
  it("turns a question into quoted words, so its punctuation can't break the query", () => {
    expect(ftsTerms('What is "σ"? NEAR (mean*)')).toEqual(['"σ"', '"near"', '"mean"']);
    expect(ftsTerms("what is it")).toEqual(['"what"', '"is"', '"it"']);
    expect(ftsTerms("?!")).toEqual([]);
  });

  it("ranks the folder's chunks and anchors each hit to the page of its first match", () => {
    const { search, folder, book } = setup();
    const hits = search.search(folder.id, "standard deviation");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ materialId: book.id, materialName: "book.pdf", loc: 3, headings: ["Spread"] });
    expect(hits[0]!.snippet).toContain(`${HIT_START}standard${HIT_END}`);
  });

  it("stems words and falls back to any word when no chunk has them all", () => {
    const { search, folder } = setup();
    expect(search.search(folder.id, "averages").map((h) => h.loc)).toEqual([1]);
    expect(search.search(folder.id, "mean variance").map((h) => h.loc).sort()).toEqual([1, 3]);
  });

  it("follows re-imports and deletions", () => {
    const { search, materials, folder, book } = setup();
    materials.saveChunks(book.id, "page", 1, [chunk(1, 1, "Only the median remains.")]);
    expect(search.search(folder.id, "deviation")).toEqual([]);
    expect(search.search(folder.id, "median")).toHaveLength(1);
    materials.remove(book.id);
    expect(search.search(folder.id, "median")).toEqual([]);
  });
});
