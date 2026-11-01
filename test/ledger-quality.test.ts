import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDb } from "../server/db.ts";
import { findQuote, normaliseForMatch } from "../server/ledger/quote.ts";
import { createLedger, exactDuplicates, locate } from "../server/ledger/store.ts";
import { createLibrary } from "../server/library.ts";

describe("findQuote", () => {
  it("sees through ligatures, line-break hyphens, curly quotes, dashes and emphasis", () => {
    expect(findQuote("The deﬁnition holds.", "definition holds")?.how).toBe("full");
    expect(findQuote("a linear transfor-\nmation of x", "linear transformation")?.how).toBe("full");
    expect(findQuote("the “sample” mean", 'the "sample" mean')?.how).toBe("full");
    expect(findQuote("pages 3–5 only", "pages 3-5")?.how).toBe("full");
    expect(findQuote("a **bold** claim", "a bold claim")?.how).toBe("full");
  });

  it("keeps a real hyphen before a capital or a space", () => {
    expect(normaliseForMatch("Chi-\nSquare").text).toBe("chi- square");
    expect(normaliseForMatch("well-known").text).toBe("well-known");
  });

  it("returns the offset in the original text", () => {
    const text = "Intro  \n\n deﬁnition of data";
    expect(findQuote(text, "definition")!.at).toBe(text.indexOf("deﬁnition"));
    expect(findQuote(text, "of data")!.at).toBe(text.indexOf("of data"));
  });

  it("matches text whose spaces extraction lost or added, when long enough", () => {
    expect(findQuote("Hours SpentPlaying Video Games", "hours spent playing video")?.how).toBe("full");
    expect(findQuote("S A M P L I N G  M E T H O D S", "sampling methods")?.how).toBe("full");
    expect(findQuote("a b c", "abc")).toBeNull();
  });

  it("matches a cut quote on its longest piece, and a stitched one on its ends", () => {
    const text = "Find the 80th percentile first. Much later: Thus, the 80th percentile is 8.5.";
    expect(findQuote(text, "Find the... Thus, the 80th percentile is 8.5.")).toEqual({ at: text.indexOf("Thus"), how: "partial" });
    const stitched = "one two three four five six seven not in the page at all today";
    expect(findQuote("before one two three four five six after", stitched)?.how).toBe("partial");
  });

  it("does not match a paraphrase or an empty quote", () => {
    expect(findQuote("The mean is the average.", "Averages are computed by adding values")).toBeNull();
    expect(findQuote("Anything", "   ")).toBeNull();
  });
});

describe("locate", () => {
  const chunk = { text: "Page five text here.", marks: [[0, 5]] as [number, number][], from: 5 };
  const next = { text: "Page six begins.\n\nPage seven has the sentence we want.", marks: [[0, 6], [18, 7]] as [number, number][], from: 6 };

  it("finds a quote in a neighbouring chunk", () => {
    expect(locate(chunk, "the sentence we want", [next])).toBe(7);
    expect(locate(chunk, "text here", [next])).toBe(5);
  });

  it("leaves a short or missing quote at its own chunk", () => {
    expect(locate(chunk, "seven", [next])).toBe(5);
    expect(locate(chunk, "this sentence is nowhere", [next])).toBe(5);
  });
});

describe("exactDuplicates", () => {
  const row = (type: string, title: string, statement = "s") => ({ type, title, statement });

  it("treats definitions and concepts with one title as one idea", () => {
    const groups = exactDuplicates([row("definition", "Definition of dot plot"), row("concept", "Dot Plot"), row("definition", "Bar chart")]);
    expect(groups.map((g) => g.map((r) => r.title))).toEqual([["Definition of dot plot", "Dot Plot"]]);
  });

  it("needs the same type for a formula", () => {
    expect(exactDuplicates([row("formula", "Mean"), row("concept", "Mean")])).toEqual([]);
    expect(exactDuplicates([row("formula", "Mean"), row("formula", "The mean")])).toHaveLength(1);
  });

  it("doesn't merge examples on title alone", () => {
    expect(exactDuplicates([row("example", "Example 1", "tossing a coin twice"), row("example", "Example 1", "heights of ten students")])).toEqual([]);
    expect(exactDuplicates([row("example", "Example 1", "tossing a coin twice"), row("example", "Example 1", "tossing a coin twice over")])).toHaveLength(1);
  });
});

function setup() {
  const db = openDb(":memory:");
  const ledger = createLedger(db);
  const folder = createLibrary(db).createFolder("Statistics", null);
  const materialId = randomUUID();
  db.prepare("INSERT INTO materials (id, folder_id, kind, name, size, sha256, status, created_at) VALUES (?, ?, 'pdf', 'book.pdf', 1, 'x', 'ready', 0)").run(materialId, folder.id);
  const addChunk = (ord: number, text: string, from = ord + 1) => {
    const id = randomUUID();
    db.prepare("INSERT INTO chunks (id, material_id, ord, loc_from, loc_to, headings, text, tokens, marks) VALUES (?, ?, ?, ?, ?, '[]', ?, 1, ?)")
      .run(id, materialId, ord, from, from, text, JSON.stringify([[0, from]]));
    return id;
  };
  let order = 0;
  const addItem = (type: string, title: string, statement: string, chunkId: string, quote = "", fields: { origin?: string; status?: string; mark?: string } = {}) => {
    const id = randomUUID();
    order++;
    db.prepare("INSERT INTO items (id, folder_id, type, title, statement, origin, status, mark, merge_checked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)")
      .run(id, folder.id, type, title, statement, fields.origin ?? "extracted", fields.status ?? "pending", fields.mark ?? null, order, order);
    db.prepare("INSERT INTO item_sources (item_id, chunk_id, material_id, loc, quote) VALUES (?, ?, ?, 1, ?)").run(id, chunkId, materialId, quote);
    return id;
  };
  return { db, ledger, folder, addChunk, addItem };
}

describe("merging", () => {
  it("merges exact duplicates in code: first item, fullest statement, all sources", () => {
    const t = setup();
    const a = t.addChunk(0, "one");
    const b = t.addChunk(1, "two");
    const keep = t.addItem("definition", "Data", "Facts.", a);
    t.addItem("concept", "Data definition", "Facts collected for study.", b);
    t.addItem("example", "Data", "Unrelated example.", b);
    expect(t.ledger.mergeExact(t.folder.id)).toBe(1);
    const items = t.ledger.list(t.folder.id);
    expect(items).toHaveLength(2);
    expect(t.ledger.get(keep)).toMatchObject({ title: "Data", statement: "Facts collected for study." });
    expect(t.ledger.get(keep).sources).toHaveLength(2);
  });

  it("leaves items added by hand alone", () => {
    const t = setup();
    t.addItem("concept", "Data", "x", t.addChunk(0, "one"));
    t.ledger.addManual(t.folder.id, { type: "concept", title: "Data", statement: "mine" });
    expect(t.ledger.mergeExact(t.folder.id)).toBe(0);
    expect(t.ledger.list(t.folder.id)).toHaveLength(2);
  });

  it("carries the learner's record to the item that stays", () => {
    const t = setup();
    const c = t.addChunk(0, "one");
    const keep = t.addItem("concept", "Mean", "a", c);
    const drop = t.addItem("concept", "Mean again", "b", c, "", { status: "mastered", mark: "known" });
    const other = t.addItem("concept", "Median", "m", c);
    t.db.prepare("INSERT INTO item_events (item_id, folder_id, kind, score, at) VALUES (?, ?, 'check', 1, 0)").run(drop, t.folder.id);
    t.db.prepare("INSERT INTO cards (id, folder_id, item_id, kind, front, back, origin, created_at, updated_at) VALUES ('c1', ?, ?, 'basic', 'f', 'b', 'taught', 0, 0)").run(t.folder.id, drop);
    t.db.prepare("INSERT INTO item_links (folder_id, from_id, to_id, kind) VALUES (?, ?, ?, 'follows')").run(t.folder.id, drop, other);
    t.db.prepare("INSERT INTO item_links (folder_id, from_id, to_id, kind) VALUES (?, ?, ?, 'follows')").run(t.folder.id, keep, drop);

    t.ledger.merge(keep, [drop], "Mean", "The mean.");

    expect(t.ledger.get(keep)).toMatchObject({ status: "mastered", mark: "known", statement: "The mean." });
    const one = (sql: string) => t.db.prepare(sql).get() as { n: number };
    expect(t.db.prepare("SELECT item_id FROM item_events").all()).toEqual([{ item_id: keep }]);
    expect(t.db.prepare("SELECT item_id FROM cards").all()).toEqual([{ item_id: keep }]);
    // keep -> drop would point at itself now, so it's gone; drop -> other moved.
    expect(t.db.prepare("SELECT from_id, to_id FROM item_links").all()).toEqual([{ from_id: keep, to_id: other }]);
    expect(one("SELECT count(*) AS n FROM items").n).toBe(2);
  });

  it("sends a long chain of similar titles in pieces, losing nobody", () => {
    const t = setup();
    const c = t.addChunk(0, "one");
    // Each title shares enough words with the next to chain them into one group.
    const titles = Array.from({ length: 14 }, (_, i) => `alpha beta gamma delta ${i}`);
    for (const title of titles) t.addItem("fact", title, title, c);
    t.db.prepare("UPDATE items SET merge_checked = 0").run();
    const groups = t.ledger.mergeCandidates(t.folder.id, 6);
    expect(groups.map((g) => g.length)).toEqual([6, 6, 2]);
    expect(new Set(groups.flat().map((r) => r.title)).size).toBe(14);
  });
});

describe("tidyOnce", () => {
  it("re-anchors, merges and reopens cut-short groups, once only", () => {
    const t = setup();
    const a = t.addChunk(0, "nothing useful here", 1);
    t.addChunk(1, "the mean is the average of the values", 2);
    const moved = t.addItem("concept", "Mean", "m", a, "the mean is the average");
    t.addItem("definition", "Definition of mean", "mm", a);
    for (let i = 0; i < 8; i++) t.addItem("fact", `alpha beta gamma delta ${i}`, `s${i}`, a);

    expect(t.ledger.tidyOnce()).toBe(true);

    expect(t.ledger.get(moved).sources.map((s) => s.loc)).toContain(2);
    expect(t.ledger.list(t.folder.id)).toHaveLength(9);
    expect(t.ledger.mergeCandidates(t.folder.id).flat()).toHaveLength(8);

    t.addItem("concept", "Mean again today", "x", a);
    t.addItem("concept", "Mean again today", "y", a);
    expect(t.ledger.tidyOnce()).toBe(false);
    expect(t.ledger.list(t.folder.id)).toHaveLength(11);
  });
});
