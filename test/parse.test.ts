import { describe, expect, it } from "vitest";
import { chunkBlocks } from "../server/materials/chunk.ts";
import { detectKind, parseMaterial } from "../server/materials/parse.ts";
import { makeDocx, makePdf, makePptx } from "./fixtures.ts";

const utf8 = (s: string) => new TextEncoder().encode(s);

describe("detectKind", () => {
  it("trusts file contents over names", () => {
    expect(detectKind("notes.txt", makePdf([["x"]]))).toBe("pdf");
    expect(detectKind("lecture.docx", makeDocx([["", "x"]]))).toBe("docx");
    expect(detectKind("slides.pptx", makePptx([{ lines: ["x"] }]))).toBe("pptx");
    expect(detectKind("photo.bin", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]))).toBe("image");
    expect(detectKind("README.md", utf8("# Hi"))).toBe("markdown");
    expect(detectKind("notes", utf8("plain"))).toBe("text");
  });

  it("refuses formats it can't read, with a way forward", () => {
    expect(() => detectKind("old.doc", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toThrow(/Save as PDF/);
    expect(() => detectKind("blob", new Uint8Array([0xff, 0xfe, 0x00, 0xd8, 0x00]))).toThrow(/isn't a format/);
  });
});

describe("parseMaterial", () => {
  it("reads PDF text page by page", async () => {
    const parsed = await parseMaterial("pdf", makePdf([["Signals are functions of time."], ["Systems map signals to sig-", "nals (and obey rules)."]]));
    expect(parsed.unit).toBe("page");
    expect(parsed.length).toBe(2);
    expect(parsed.blocks).toEqual([
      { loc: 1, text: "Signals are functions of time." },
      { loc: 2, text: "Systems map signals to signals (and obey rules)." },
    ]);
  });

  it("reports damaged PDFs plainly", async () => {
    await expect(parseMaterial("pdf", utf8("%PDF-1.4 garbage"))).rejects.toThrow(/couldn't be opened/);
  });

  it("keeps Word headings, body text and tables", async () => {
    const parsed = await parseMaterial("docx", makeDocx([["Heading1", "Unit 1 & 2"], ["", "Ohm's law: V = IR."], ["Heading2", "Power"]]));
    expect(parsed.blocks).toEqual([
      { loc: 1, heading: 1, text: "Unit 1 & 2" },
      { loc: 2, text: "Ohm's law: V = IR." },
      { loc: 3, heading: 2, text: "Power" },
    ]);
  });

  it("reads slide titles, bullets and speaker notes", async () => {
    const parsed = await parseMaterial("pptx", makePptx([
      { lines: ["Fourier series", "Periodic signals", "Sum of sinusoids"], notes: "Stress the Dirichlet conditions." },
      { lines: ["Summary"] },
    ]));
    expect(parsed.unit).toBe("slide");
    expect(parsed.blocks).toEqual([
      { loc: 1, heading: 1, text: "Fourier series" },
      { loc: 1, text: "Periodic signals\nSum of sinusoids" },
      { loc: 1, text: "Speaker notes: Stress the Dirichlet conditions." },
      { loc: 2, heading: 1, text: "Summary" },
    ]);
  });

  it("splits Markdown at headings and paragraphs but not inside code fences", async () => {
    const parsed = await parseMaterial("markdown", utf8("# Rust\nOwnership rules.\n\n```sh\n# not a heading\n\nstill code\n```\n## Borrowing\n\nOne mutable reference."));
    expect(parsed.blocks.map((b) => [b.loc, b.heading ?? 0, b.text.split("\n")[0]])).toEqual([
      [1, 1, "Rust"], [2, 0, "Ownership rules."], [4, 0, "```sh"], [9, 2, "Borrowing"], [11, 0, "One mutable reference."],
    ]);
    expect(parsed.blocks[2]!.text).toContain("still code");
  });
});

describe("chunkBlocks", () => {
  it("packs small blocks together and records the source range and heading path", () => {
    const chunks = chunkBlocks("page", [
      { loc: 1, heading: 1, text: "Unit 1" },
      { loc: 1, heading: 2, text: "Signals" },
      { loc: 1, text: "Short text." },
      { loc: 2, text: "More text." },
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ anchor: { unit: "page", from: 1, to: 2 }, headings: ["Unit 1"] });
    expect(chunks[0]!.text).toContain("## Signals");
  });

  it("starts a new chunk at a major heading and carries the path", () => {
    const body = "x".repeat(2000); // 500 tokens
    const chunks = chunkBlocks("page", [
      { loc: 1, heading: 1, text: "Unit 1" },
      { loc: 1, text: body },
      { loc: 3, heading: 1, text: "Unit 2" },
      { loc: 3, heading: 2, text: "Systems" },
      { loc: 4, text: "LTI." },
    ], 1200);
    expect(chunks.map((c) => [c.anchor.from, c.anchor.to])).toEqual([[1, 1], [3, 4]]);
    expect(chunks[1]!.headings).toEqual(["Unit 2"]);
    expect(chunks[1]!.text.startsWith("# Unit 2")).toBe(true);
  });

  it("splits an oversized block by sentences without losing text", () => {
    const sentences = Array.from({ length: 40 }, (_, i) => `Sentence ${i} ${"word ".repeat(30)}ends here.`);
    const chunks = chunkBlocks("page", [{ loc: 7, text: sentences.join(" ") }], 300);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.tokens <= 300 && c.anchor.from === 7)).toBe(true);
    expect(chunks.map((c) => c.text).join(" ")).toBe(sentences.join(" "));
  });
});
