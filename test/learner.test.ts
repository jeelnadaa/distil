import { describe, expect, it } from "vitest";
import { openDb } from "../server/db.ts";
import { createLearner } from "../server/learning/learner.ts";
import { Brief } from "../server/learning/types.ts";
import { createLedger } from "../server/ledger/store.ts";
import { createLibrary } from "../server/library.ts";

function setup() {
  const db = openDb(":memory:");
  const folder = createLibrary(db).createFolder("Stats", null);
  const ledger = createLedger(db);
  const add = (title: string) => ledger.addManual(folder.id, { type: "concept", title, statement: `${title} explained.` }).id;
  const status = (id: string) => (db.prepare("SELECT status FROM items WHERE id = ?").get(id) as { status: string }).status;
  return { db, learner: createLearner(db), add, status };
}

describe("learner", () => {
  it("only moves statuses forward", () => {
    const { learner, add, status } = setup();
    const a = add("Mean"), b = add("Median");
    expect(learner.advance([a, b], "planned")).toBe(2);
    learner.advance([a], "checked");
    expect(learner.advance([a, b], "taught")).toBe(1);
    expect([status(a), status(b)]).toEqual(["checked", "taught"]);
  });

  it("derives statuses from evidence: teaching, then an unaided passed check", () => {
    const { learner, add, status } = setup();
    const a = add("Variance");
    learner.record({ itemId: a, kind: "taught", chatId: "c1" });
    expect(status(a)).toBe("taught");
    learner.record({ itemId: a, kind: "check", score: 1, withHelp: true });
    learner.record({ itemId: a, kind: "check", score: 0.4 });
    expect(status(a)).toBe("taught");
    learner.record({ itemId: a, kind: "practice", score: 0.8, confidence: "sure" });
    expect(status(a)).toBe("checked");
    expect(learner.events(a).map((e) => e.kind)).toEqual(["taught", "check", "check", "practice"]);
  });

  it("rejects evidence for an unknown item", () => {
    expect(() => setup().learner.record({ itemId: "nope", kind: "check", score: 1 })).toThrow(/not found/);
  });
});

describe("Brief", () => {
  it("fills visible defaults for everything not given", () => {
    expect(Brief.parse({ goal: "Pass the stats mid-term" })).toMatchObject({ depth: "standard", deadline: null, daysOff: [], language: "English" });
    expect(() => Brief.parse({ goal: "x", deadline: "next week" })).toThrow();
  });
});
