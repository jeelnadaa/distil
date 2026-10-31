import { describe, expect, it } from "vitest";
import { locLabel, sections } from "../web/src/lib/viewer.ts";

describe("viewer sections", () => {
  it("splits chunks at location marks and joins a location that continues into the next chunk", () => {
    const parts = sections([
      { text: "Page one.\n\nPage two starts.", marks: [[0, 1], [11, 2]], from: 1 },
      { text: "Page two ends.\n\nPage three.", marks: [[0, 2], [16, 3]], from: 2 },
      { text: "Old chunk without marks.", marks: [], from: 7 },
    ]);
    expect(parts).toEqual([
      { loc: 1, text: "Page one." },
      { loc: 2, text: "Page two starts.\n\nPage two ends." },
      { loc: 3, text: "Page three." },
      { loc: 7, text: "Old chunk without marks." },
    ]);
  });

  it("labels locations the way anchors are cited", () => {
    expect([locLabel("page", 14), locLabel("slide", 6), locLabel("line", 12), locLabel(null, 3)]).toEqual(["p.14", "slide 6", "line 12", "#3"]);
  });
});
