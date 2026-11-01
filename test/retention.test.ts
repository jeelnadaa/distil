import { describe, expect, it } from "vitest";
import { openDb } from "../server/db.ts";
import { createJobs } from "../server/jobs.ts";
import { createLearner } from "../server/learning/learner.ts";
import { createLedger } from "../server/ledger/store.ts";
import { createLibrary } from "../server/library.ts";
import { createSearch } from "../server/materials/search.ts";
import { chatContext } from "../server/plan/context.ts";
import { createPlans } from "../server/plan/store.ts";
import type { Providers } from "../server/providers/service.ts";
import type { LocalModels } from "../server/retrieval/local.ts";
import { createRetrieval } from "../server/retrieval/retrieve.ts";
import { createVectors } from "../server/retrieval/vectors.ts";
import { createCards, NEW_PER_DAY } from "../server/retention/cards.ts";
import { createRetention } from "../server/retention/engine.ts";
import { NEW_CARD, preview, retrievability, review } from "../server/retention/fsrs.ts";
import { masteryOf } from "../server/retention/mastery.ts";
import { createSettings } from "../server/settings.ts";
import { createUsage } from "../server/usage.ts";

const DAY = 86_400_000;
const MIN = 60_000;
type Request = { system: string; messages: { content: string }[] };

function setup(o: { cards?: string; links?: string } = {}) {
  const db = openDb(":memory:");
  const settings = createSettings(db);
  settings.update({ models: { strong: { provider: "google", id: "strong" }, cheap: { provider: "google", id: "cheap" } } });
  const library = createLibrary(db);
  const ledger = createLedger(db);
  const plans = createPlans(db);
  const learner = createLearner(db);
  const usage = createUsage(db);
  const requests: Request[] = [];
  const providers = {
    async *stream(_ref: unknown, req: Request) {
      requests.push(req);
      const text = req.system.startsWith("You write flashcards") ? o.cards ?? `{"cards":[{"item":"k1","kind":"cloze","front":"The {{c1::mean}} is the average.","back":"—"}]}`
        : req.system.startsWith("You map") ? o.links ?? `{"links":[{"from":"n2","to":"n1","kind":"follows"},{"from":"n1","to":"n2","kind":"follows"},{"from":"n3","to":"n1","kind":"supports"}]}`
        : "Because the mean adds everything up.";
      yield { type: "text" as const, text };
      yield { type: "usage" as const, usage: { input: 10, output: 10, cached: 0, reasoning: 0 } };
    },
    describe: () => "fake",
    withKeys: (chain: unknown[]) => chain,
  } as unknown as Providers;
  const jobs = createJobs(db);
  const retrieval = createRetrieval({ db, search: createSearch(db), vectors: createVectors(db), local: {} as LocalModels, providers, settings, usage });
  const cards = createCards(db);
  const retention = createRetention({ providers, settings, usage, db, jobs, ledger, plans, learner, retrieval, cards });
  const folder = library.createFolder("Statistics", null);
  const items = ["Mean", "Median", "Variance"].map((title) => ledger.addManual(folder.id, { type: "concept", title, statement: `${title}, stated.` }));
  const planId = plans.createDraft(folder.id, "course");
  plans.append(planId, [{ title: "Centre", summary: "", lessons: [{ key: "a", title: "Averages", summary: "", kind: "lesson", minutes: 40, weight: 1, aids: [], items: items.map((i) => i.id), after: [] }] }], new Map());
  plans.activate(planId);
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 5));
    expect(ok()).toBe(true);
  };
  return { db, library, ledger, learner, cards, retention, folder, items, plans, planId, requests, jobs, until };
}

describe("FSRS scheduling", () => {
  it("steps a new card through learning in minutes, then schedules days that grow with each good review", () => {
    const t = Date.UTC(2026, 10, 1);
    const [again, hard, good, easy] = preview(NEW_CARD, t);
    expect([again!, hard!, good!].map((ms) => ms / MIN)).toEqual([1, 5.5, 10]);
    expect(easy! / DAY).toBeGreaterThanOrEqual(8);
    let card = review(NEW_CARD, 3, t);
    expect(card.state.phase).toBe("learning");
    card = review(card.state, 3, card.due);
    expect(card.state.phase).toBe("review");
    const first = (card.due - card.state.last!) / DAY;
    const next = review(card.state, 3, card.due);
    expect((next.due - next.state.last!) / DAY).toBeGreaterThan(first * 1.5);
    // A lapse goes back to a 10-minute relearning step with lower stability.
    const lapse = review(next.state, 1, next.due);
    expect(lapse.state).toMatchObject({ phase: "relearning", lapses: 1 });
    expect(lapse.state.stability).toBeLessThan(next.state.stability);
    expect((lapse.due - next.due) / MIN).toBe(10);
    // Grades order the intervals for a card in review.
    const p = preview(next.state, next.due + 5 * DAY);
    expect(p[0]! < p[1]! && p[1]! < p[2]! && p[2]! < p[3]!).toBe(true);
    expect(retrievability(next.state.stability, next.state.stability)).toBeCloseTo(0.9, 2);
  });
});

describe("mastery", () => {
  it("needs more than one answer, counts help at half, and slips back over time", () => {
    const t = 100 * DAY;
    expect(masteryOf([], null, false, t)).toEqual({ value: 0, level: "new" });
    expect(masteryOf([{ kind: "taught", score: null, withHelp: 0, at: t }], null, true, t).level).toBe("shaky");
    const once = masteryOf([{ kind: "check", score: 1, withHelp: 0, at: t }], null, true, t);
    expect(once.level).toBe("shaky");
    const many = [0, 1, 2, 3].map((d) => ({ kind: "practice", score: 1, withHelp: 0, at: t - d * DAY }));
    expect(masteryOf(many, null, true, t).level).toBe("mastered");
    const helped = many.map((e) => ({ ...e, withHelp: 1 }));
    expect(masteryOf(helped, null, true, t).value).toBeLessThan(masteryOf(many, null, true, t).value);
    expect(masteryOf(many, null, true, t + 120 * DAY).value).toBeLessThan(masteryOf(many, null, true, t).value);
  });
});

describe("cards and reviews", () => {
  it("queues due cards before new ones, limits new cards a day, and records reviews as evidence", () => {
    const s = setup();
    for (let i = 0; i < NEW_PER_DAY + 5; i++) s.cards.create({ folderId: s.folder.id, kind: "basic", front: `Q${i}`, back: "A", origin: "manual" });
    const linked = s.cards.create({ folderId: s.folder.id, itemId: s.items[0]!.id, kind: "basic", front: "What is the mean?", back: "The average.", origin: "manual" });
    let q = s.cards.queue(s.folder.id);
    expect(q).toMatchObject({ due: 0, fresh: NEW_PER_DAY });
    expect(q.cards[0]!.preview).toHaveLength(4);
    s.retention.review(linked.id, 4);
    q = s.cards.queue(s.folder.id);
    expect(q).toMatchObject({ fresh: NEW_PER_DAY - 1, reviewedToday: 1 });
    expect(q.nextDue).toBeGreaterThan(Date.now() + DAY);
    expect(s.learner.events(s.items[0]!.id)).toMatchObject([{ kind: "review", score: 1 }]);
    expect(s.retention.progress(s.folder.id)).toMatchObject({ counts: { shaky: 1, new: 2 }, cards: { total: NEW_PER_DAY + 6 } });
  });

  it("writes cards for a finished lesson's taught items, once, and round-trips Anki text", async () => {
    const s = setup();
    s.learner.advance([s.items[0]!.id, s.items[1]!.id], "taught");
    s.retention.lessonDone(s.plans.get(s.planId).lessons[0]!.id);
    await s.until(() => s.cards.list(s.folder.id).length === 2);
    const made = s.cards.list(s.folder.id);
    expect(made.find((c) => c.itemId === s.items[0]!.id)).toMatchObject({ kind: "cloze", origin: "taught", itemTitle: "Mean" });
    // The item the model skipped still got a plain card.
    expect(made.find((c) => c.itemId === s.items[1]!.id)).toMatchObject({ kind: "basic", front: "What do you know about Median?" });
    expect(s.retention.generate(s.folder.id)).toBeNull();

    const tsv = s.cards.exportTsv(s.folder.id);
    expect(tsv).toContain("The {{c1::mean}} is the average.\t—\tdistil cloze");
    const other = s.library.createFolder("Copy", null);
    expect(s.cards.importTsv(other.id, `${tsv}Line one<br>two\tBack &amp; more\n`)).toBe(3);
    expect(s.cards.list(other.id).map((c) => [c.front, c.back, c.kind])).toContainEqual(["Line one\ntwo", "Back & more", "basic"]);
    expect(() => s.cards.importTsv(other.id, "no tabs here")).toThrow(/No cards/);
  });

  it("explains a card from its item", async () => {
    const s = setup();
    const card = s.cards.create({ folderId: s.folder.id, itemId: s.items[0]!.id, kind: "basic", front: "Mean?", back: "Average", origin: "manual" });
    expect(await s.retention.explain(card.id)).toBe("Because the mean adds everything up.");
    expect(s.requests.at(-1)!.messages[0]!.content).toContain("Ledger item: Mean: Mean, stated.");
  });
});

describe("digest, stats and graph", () => {
  it("gives folder chats a digest of what was studied unless the chat is independent", () => {
    const s = setup();
    s.learner.record({ itemId: s.items[0]!.id, kind: "check", score: 0 });
    const chat = s.library.createChat(s.folder.id);
    const context = chatContext(s.db, s.retention.digest);
    expect(context(chat)).toContain("- Shaky or not yet checked: Mean");
    expect(context(s.library.updateChat(chat.id, { independent: true }))).not.toContain("What the learner has studied");
  });

  it("counts studied days in a streak, bridging one missed day a week, and XP only for verified learning", () => {
    const s = setup();
    const today = Date.now();
    for (const d of [0, 1, 3, 4]) s.db.prepare("INSERT INTO item_events (item_id, folder_id, kind, score, with_help, at) VALUES (?, ?, 'check', 1, 0, ?)").run(s.items[0]!.id, s.folder.id, today - d * DAY);
    s.db.prepare("INSERT INTO item_events (item_id, folder_id, kind, score, with_help, at) VALUES (?, ?, 'practice', 1, 1, ?)").run(s.items[0]!.id, s.folder.id, today);
    expect(s.retention.stats(today)).toMatchObject({ streak: 4, freezes: 1, xp: 40, level: 1, today: true });
  });

  it("maps how items build on each other without cycles, and colours nodes by mastery", async () => {
    const s = setup();
    const unit = s.plans.get(s.planId).units[0]!;
    s.retention.buildGraph(s.folder.id, unit.id);
    await s.until(() => s.retention.graph(s.folder.id, unit.id).edges.length > 0);
    const g = s.retention.graph(s.folder.id, unit.id);
    expect(g.edges).toEqual(expect.arrayContaining([
      { from: s.items[1]!.id, to: s.items[0]!.id, kind: "follows" },
      { from: s.items[2]!.id, to: s.items[0]!.id, kind: "supports" },
    ]));
    expect(g.edges).toHaveLength(2);
    expect(g.nodes.map((n) => n.level)).toEqual(["new", "new", "new"]);
    expect(g.units).toMatchObject([{ id: unit.id, items: 3, linked: true }]);
  });
});
