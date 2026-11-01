import { z } from "zod";
import type { Db } from "../db.ts";
import { AppError } from "../errors.ts";
import type { Jobs } from "../jobs.ts";
import type { Item, Ledger } from "../ledger/store.ts";
import { type Learner, PASS } from "../learning/learner.ts";
import { complete, completeJson, type LlmDeps } from "../llm.ts";
import type { Plans } from "../plan/store.ts";
import type { Retrieval } from "../retrieval/retrieve.ts";
import { type Card, CARD_KINDS, type Cards, startOfDay } from "./cards.ts";
import type { Grade } from "./fsrs.ts";
import { type Evidence, type Level, type Mastery, MASTERED, masteryOf } from "./mastery.ts";

// Retention (Phase 7): cards written for what was taught (F-901), reviews that feed mastery (F-902, F-911),
// a progress view per folder (F-912), the digest a new chat in a folder starts with (F-925), streaks and
// XP when switched on (F-931, F-932), and the knowledge graph of how items build on each other (F-921).

export type RetentionDeps = LlmDeps & {
  db: Db; jobs: Jobs; ledger: Ledger; plans: Plans; learner: Learner; retrieval: Retrieval; cards: Cards;
};

const DAY = 86_400_000;
const CARD_BATCH = 20;
const DIGEST_ITEMS = 40;
const GRAPH_ITEMS = 60;
const SUBTREE = "WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id)";

export type ItemMastery = Mastery & { id: string; title: string; status: string; lastAt: number | null };
export type ProgressView = {
  counts: Record<Level, number>; total: number;
  units: { id: string; title: string; lessons: { id: string; title: string; items: number; mastery: number; taught: number }[] }[];
  weak: ItemMastery[]; cards: { total: number; due: number };
};
export type GraphView = {
  units: { id: string; title: string; items: number; linked: boolean }[];
  unit: string | null;
  nodes: { id: string; title: string; type: string; lesson: string | null; mastery: number; level: Level; source: { materialId: string; loc: number } | null }[];
  edges: { from: string; to: string; kind: "follows" | "supports" }[];
  lessons: Record<string, string>;
};
export type Stats = { streak: number; best: number; freezes: number; xp: number; level: number; nextLevelXp: number; today: boolean };

const Written = z.object({ cards: z.array(z.object({ item: z.string(), kind: z.enum(CARD_KINDS).default("basic"), front: z.string().min(1).max(800), back: z.string().min(1).max(1500) })) });
const CARDS = `You write flashcards that make a learner recall what they were taught, one or two per ledger item.
Reply with JSON only: {"cards": [{"item": "key", "kind": "basic" | "reverse" | "cloze" | "formula", "front": "…", "back": "…"}]}
- basic: a question on the front that can only be answered by recalling the item; the answer on the back, short.
- reverse: a term and its meaning, to be asked both ways; front is the term, back the meaning.
- cloze: one sentence from the item with the key part hidden as {{c1::hidden words}}; back is extra context or empty-ish ("—").
- formula: front names what the formula gives, back is the formula in $…$ with what each symbol means.
- One idea per card. No yes/no questions. No trivia about the course or the book. Use $…$ for maths.`;

const Links = z.object({ links: z.array(z.object({ from: z.string(), to: z.string(), kind: z.enum(["follows", "supports"]) })).max(200) });
const LINKER = `You map how the ideas in one part of a course depend on each other, for a knowledge graph.
You get ledger items by key. Reply with JSON only: {"links": [{"from": "key", "to": "key", "kind": "follows" | "supports"}]}
- follows: "from" can't be understood without "to" (a prerequisite, a definition it uses, a result it is derived from).
- supports: "from" is evidence for, an example of, or an application of "to".
- Only links a teacher would draw; most items have one to three. No link from an item to itself, no cycles of "follows".`;

const EXPLAIN = `You explain one flashcard to a learner who just reviewed it: why the answer is what it is, in a short paragraph and, if it helps, one example. Use $…$ for maths. Don't restate the card.`;

export function createRetention(deps: RetentionDeps) {
  const { db, cards, ledger, learner } = deps;
  const now = () => Date.now();

  // ----- Mastery (F-911) -----

  function masteryMap(folderId: string, at = now()): Map<string, ItemMastery> {
    const items = ledger.list(folderId).filter((i) => !i.mark);
    const rows = db.prepare(`${SUBTREE} SELECT item_id, kind, score, with_help AS withHelp, at FROM item_events WHERE folder_id IN (SELECT id FROM sub) ORDER BY at`)
      .all(folderId) as (Evidence & { item_id: string })[];
    const byItem = new Map<string, Evidence[]>();
    for (const r of rows) (byItem.get(r.item_id) ?? byItem.set(r.item_id, []).get(r.item_id)!).push(r);
    const cardOf = new Map<string, Card>();
    for (const c of cards.list(folderId)) if (c.itemId && (!cardOf.has(c.itemId) || (c.state.last ?? 0) > (cardOf.get(c.itemId)!.state.last ?? 0))) cardOf.set(c.itemId, c);
    return new Map(items.map((i) => {
      const events = byItem.get(i.id) ?? [];
      const m = masteryOf(events, cardOf.get(i.id)?.state ?? null, i.status !== "pending" && i.status !== "planned", at);
      return [i.id, { ...m, id: i.id, title: i.title, status: i.status, lastAt: events.at(-1)?.at ?? null }];
    }));
  }

  function progress(folderId: string): ProgressView {
    const map = masteryMap(folderId);
    const counts: Record<Level, number> = { new: 0, shaky: 0, solid: 0, mastered: 0 };
    for (const m of map.values()) counts[m.level]++;
    const plan = deps.plans.active(folderId);
    const units = (plan?.units ?? []).map((u) => ({
      id: u.id, title: u.title,
      lessons: plan!.lessons.filter((l) => l.unitId === u.id).map((l) => {
        const own = l.items.map((id) => map.get(id)).filter((m): m is ItemMastery => !!m);
        const avg = own.length ? own.reduce((s, m) => s + m.value, 0) / own.length : 0;
        return { id: l.id, title: l.title, items: own.length, mastery: Math.round(avg * 100) / 100, taught: own.filter((m) => m.level !== "new").length };
      }),
    }));
    const weak = [...map.values()].filter((m) => m.level === "shaky").sort((a, b) => a.value - b.value || (b.lastAt ?? 0) - (a.lastAt ?? 0)).slice(0, 15);
    const queue = cards.queue(folderId);
    return { counts, total: map.size, units, weak, cards: { total: cards.list(folderId).length, due: queue.due + queue.fresh } };
  }

  // Items taught but not yet holding: what practice and "Fix these" aim at.
  const weakItems = (folderId: string) => [...masteryMap(folderId).values()].filter((m) => m.level === "shaky");

  // ----- Cards (F-901, F-902, F-905) -----

  // Writes cards for taught items that have none yet (or the given items), as a background job.
  function generate(folderId: string, itemIds?: string[]) {
    const want = itemIds ? new Set(itemIds) : null;
    const items = ledger.list(folderId).filter((i) => !i.mark && (want ? want.has(i.id) : ["taught", "checked", "mastered"].includes(i.status)));
    const has = cards.carded(items.map((i) => i.id));
    const todo = items.filter((i) => !has.has(i.id)).map((i) => i.id);
    if (!todo.length) return null;
    return deps.jobs.enqueue("cards", `Writing ${todo.length} flashcard${todo.length === 1 ? "" : "s"}`, { folderId, params: { items: todo } });
  }

  async function write(folderId: string, ids: string[], signal: AbortSignal, progress: (d: number, t: number) => void) {
    const all = new Map(ledger.list(folderId).map((i) => [i.id, i]));
    const items = ids.map((id) => all.get(id)).filter((i): i is Item => !!i);
    for (let at = 0; at < items.length; at += CARD_BATCH) {
      const batch = items.slice(at, at + CARD_BATCH).filter((i) => !cards.carded([i.id]).size);
      progress(at, items.length);
      if (!batch.length) continue;
      const keys = new Map(batch.map((it, i) => [`k${i + 1}`, it]));
      const reply = await completeJson(deps, Written, {
        slot: "cheap", role: "cards", folderId, system: CARDS, maxTokens: 4000, signal,
        prompt: `Ledger items (key · type · title: statement):\n${[...keys].map(([k, it]) => `${k} · ${it.type} · ${it.title}: ${it.statement.slice(0, 600)}`).join("\n")}`,
      });
      const made = new Set<string>();
      for (const c of reply.cards) {
        const item = keys.get(c.item);
        if (!item) continue;
        cards.create({ folderId: item.folderId, itemId: item.id, kind: c.kind, front: c.front, back: c.back, origin: "taught" });
        made.add(item.id);
      }
      // An item the model skipped still gets a plain card.
      for (const item of batch) if (!made.has(item.id)) cards.create({ folderId: item.folderId, itemId: item.id, kind: "basic", front: `What do you know about ${item.title}?`, back: item.statement, origin: "taught" });
    }
    progress(items.length, items.length);
  }

  // A finished lesson's items get their cards.
  function lessonDone(lessonId: string) {
    const lesson = deps.plans.lesson(lessonId);
    const plan = deps.plans.lessonPlan(lessonId);
    generate(plan.folderId, lesson.items.filter((id) => {
      try { return ledger.get(id).status !== "pending"; } catch { return false; }
    }));
  }

  // A review is evidence for its item (F-911); a card that has just become well known can lift the item to mastered.
  function review(cardId: string, grade: Grade): Card {
    const card = cards.review(cardId, grade);
    if (card.itemId) {
      try {
        learner.record({ itemId: card.itemId, kind: "review", score: grade === 1 ? 0 : grade === 2 ? 0.6 : 1, ref: card.id });
        const m = masteryMap(card.folderId).get(card.itemId);
        if (m && m.value >= MASTERED) learner.advance([card.itemId], "mastered");
      } catch { /* the item was deleted since */ }
    }
    return card;
  }

  async function explain(cardId: string, signal?: AbortSignal): Promise<string> {
    const card = cards.get(cardId);
    let context = "";
    if (card.itemId) {
      try {
        const item = ledger.get(card.itemId);
        const passages = await deps.retrieval.forItems(card.folderId, [item], 1, signal).catch(() => []);
        context = `Ledger item: ${item.title}: ${item.statement}\n\n${passages.map((p) => p.text.slice(0, 1200)).join("\n\n")}`;
      } catch { /* no item any more */ }
    }
    const text = await complete(deps, {
      slot: "cheap", role: "cards", folderId: card.folderId, system: EXPLAIN, maxTokens: 700, signal,
      prompt: `Card (${card.kind}):\nFront: ${card.front}\nBack: ${card.back}${context ? `\n\nFrom the learner's material:\n${context}` : ""}`,
    });
    return text.trim();
  }

  // ----- Digest (F-925) -----

  // What a new chat in a folder knows about the learner: built from their record, never other transcripts.
  function digest(folderId: string): string {
    const known = [...masteryMap(folderId).values()].filter((m) => m.level !== "new").sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0)).slice(0, DIGEST_ITEMS);
    if (!known.length) return "";
    const group = (level: Level) => known.filter((m) => m.level === level).map((m) => m.title);
    const lines = [
      group("mastered").length ? `- Mastered: ${group("mastered").join("; ")}` : "",
      group("solid").length ? `- Solid: ${group("solid").join("; ")}` : "",
      group("shaky").length ? `- Shaky or not yet checked: ${group("shaky").join("; ")}` : "",
    ].filter(Boolean);
    return `## What the learner has studied in this subject\nFrom their learning record, most recent first. Build on what they know, and take extra care with what is shaky.\n${lines.join("\n")}`;
  }

  // ----- Streak and XP (F-931, F-932) -----

  // A day counts when something was learned and verified: a check, practice, exam or card review, or a
  // finished lesson. One missed day a week is forgiven (a freeze). XP comes only from verified learning.
  function stats(at = now()): Stats {
    const events = db.prepare("SELECT kind, score, with_help AS withHelp, at FROM item_events WHERE kind IN ('check', 'practice', 'exam', 'review')").all() as Evidence[];
    const lessons = db.prepare("SELECT done_at AS at FROM lessons WHERE done_at IS NOT NULL").all() as { at: number }[];
    const day = (t: number) => Math.round(startOfDay(t) / DAY);
    const days = new Set([...events.map((e) => day(e.at)), ...lessons.map((l) => day(l.at))]);
    const today = day(at);
    const run = (from: number) => {
      let n = 0, freezes = 0, lastFreeze = Infinity;
      for (let d = from; ; d--) {
        if (days.has(d)) { n++; continue; }
        if (lastFreeze - d >= 7 && days.has(d - 1)) { freezes++; lastFreeze = d; continue; }
        return { n, freezes };
      }
    };
    const current = run(days.has(today) ? today : today - 1);
    // The longest run ends on a day with no activity the day after.
    let best = 0;
    for (const d of days) if (!days.has(d + 1)) best = Math.max(best, run(d).n);
    const xp = events.reduce((sum, e) => sum + (e.score === null || e.withHelp || e.score < PASS ? 0 : e.kind === "review" ? 2 : 10), 0);
    const level = Math.floor(Math.sqrt(xp / 50)) + 1;
    return { streak: current.n, best: Math.max(best, current.n), freezes: current.freezes, xp, level, nextLevelXp: 50 * level ** 2, today: days.has(today) };
  }

  // ----- Knowledge graph (F-921, F-923, F-924) -----

  function graphScope(folderId: string, unitId: string | null) {
    const plan = deps.plans.active(folderId);
    const items = new Map(ledger.list(folderId).filter((i) => !i.mark).map((i) => [i.id, i]));
    const lessonOf = new Map<string, string>();
    const lessons: Record<string, string> = {};
    for (const l of plan?.lessons ?? []) for (const id of l.items) if (!lessonOf.has(id)) { lessonOf.set(id, l.id); lessons[l.id] = l.title; }
    const units = (plan?.units ?? []).map((u) => {
      const ids = plan!.lessons.filter((l) => l.unitId === u.id).flatMap((l) => l.items).filter((id) => items.has(id));
      return { id: u.id, title: u.title, ids };
    }).filter((u) => u.ids.length);
    const unit = units.find((u) => u.id === unitId) ?? null;
    const ids = unit ? unit.ids : [...items.keys()];
    return { plan, items, lessonOf, lessons, units, unit, ids: ids.slice(0, GRAPH_ITEMS) };
  }

  function graph(folderId: string, unitId: string | null): GraphView {
    const scope = graphScope(folderId, unitId);
    const map = masteryMap(folderId);
    const linked = db.prepare("SELECT 1 FROM item_links WHERE from_id = ? OR to_id = ? LIMIT 1");
    const want = new Set(scope.ids);
    const anchor = db.prepare("SELECT material_id, loc FROM item_sources WHERE item_id = ? ORDER BY rowid LIMIT 1");
    const edges = (db.prepare("SELECT from_id AS 'from', to_id AS 'to', kind FROM item_links WHERE folder_id = ?").all(folderId) as GraphView["edges"])
      .filter((e) => want.has(e.from) && want.has(e.to));
    return {
      units: scope.units.map((u) => ({ id: u.id, title: u.title, items: u.ids.length, linked: u.ids.some((id) => linked.get(id, id)) })),
      unit: scope.unit?.id ?? null,
      nodes: scope.ids.map((id) => {
        const it = scope.items.get(id)!;
        const m = map.get(id) ?? { value: 0, level: "new" as Level };
        const a = anchor.get(id) as { material_id: string; loc: number } | undefined;
        return { id, title: it.title, type: it.type, lesson: scope.lessonOf.get(id) ?? null, mastery: m.value, level: m.level, source: a ? { materialId: a.material_id, loc: a.loc } : null };
      }),
      edges,
      lessons: Object.fromEntries(Object.entries(scope.lessons).filter(([id]) => scope.ids.some((i) => scope.lessonOf.get(i) === id))),
    };
  }

  function buildGraph(folderId: string, unitId: string | null) {
    const scope = graphScope(folderId, unitId);
    if (!scope.ids.length) throw new AppError(400, "empty_scope", "There are no items to map here yet.");
    return deps.jobs.enqueue("graph", `Mapping ${scope.unit ? scope.unit.title : "the subject"}`, { folderId, params: { unitId: scope.unit?.id ?? null } });
  }

  async function link(folderId: string, unitId: string | null, signal: AbortSignal) {
    const scope = graphScope(folderId, unitId);
    const keys = new Map(scope.ids.map((id, i) => [`n${i + 1}`, id]));
    const reply = await completeJson(deps, Links, {
      slot: "cheap", role: "graph", folderId, system: LINKER, maxTokens: 4000, signal,
      prompt: `Items (key · type · title: statement):\n${[...keys].map(([k, id]) => { const it = scope.items.get(id)!; return `${k} · ${it.type} · ${it.title}: ${it.statement.slice(0, 300)}`; }).join("\n")}`,
    });
    const ids = [...keys.values()];
    db.prepare(`DELETE FROM item_links WHERE from_id IN (${ids.map(() => "?").join(",")})`).run(...ids);
    const insert = db.prepare("INSERT OR REPLACE INTO item_links (folder_id, from_id, to_id, kind) VALUES (?, ?, ?, ?)");
    // "follows" must stay acyclic: an edge that would close a loop is dropped.
    const next = new Map<string, Set<string>>();
    const reaches = (a: string, b: string): boolean => {
      const seen = new Set<string>(), stack = [a];
      while (stack.length) { const x = stack.pop()!; if (x === b) return true; if (seen.has(x)) continue; seen.add(x); stack.push(...(next.get(x) ?? [])); }
      return false;
    };
    for (const l of reply.links) {
      const from = keys.get(l.from), to = keys.get(l.to);
      if (!from || !to || from === to) continue;
      if (l.kind === "follows") {
        if (reaches(to, from)) continue;
        (next.get(from) ?? next.set(from, new Set()).get(from)!).add(to);
      }
      insert.run(folderId, from, to, l.kind);
    }
  }

  deps.jobs.register("cards", async (job, { signal, progress }) => {
    if (job.folderId) await write(job.folderId, (job.params.items as string[]) ?? [], signal, progress);
  });
  deps.jobs.register("graph", async (job, { signal }) => {
    if (job.folderId) await link(job.folderId, (job.params.unitId as string | null) ?? null, signal);
  });

  return { masteryMap, progress, weakItems, generate, lessonDone, review, explain, digest, stats, graph, buildGraph };
}

export type Retention = ReturnType<typeof createRetention>;
