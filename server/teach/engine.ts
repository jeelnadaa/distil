import { z } from "zod";
import type { Db } from "../db.ts";
import { AppError } from "../errors.ts";
import type { Chat, Library } from "../library.ts";
import type { Ledger } from "../ledger/store.ts";
import type { Learner } from "../learning/learner.ts";
import { chainFor, completeJson, parseJsonReply, type LlmDeps } from "../llm.ts";
import type { Message, Messages, Source } from "../messages.ts";
import { briefContext, createBriefs } from "../plan/brief.ts";
import type { Lesson, Plans } from "../plan/store.ts";
import { ProviderError, type Usage } from "../providers/types.ts";
import type { Passage, Retrieval } from "../retrieval/retrieve.ts";
import { estimateTokens } from "../usage.ts";
import { answerText, CheckSpec, type Confidence, gradeExact, gradeWithModel, responseText, type Result, type Verdict } from "./checks.ts";
import { itemLines, PLANNER, planPrompt, sourceBlock, TEACHER } from "./prompts.ts";
import { type Check, checkView, type CheckView, type Session, type Step, type TeachStore } from "./store.ts";

// The teaching engine (Phase 4, §6): a lesson chat runs as a session of steps. It probes when the lesson
// builds on earlier ones, teaches one step at a time from every source on it (F-617), ends each step with
// a check (F-604), repairs a wrong answer at most twice before marking the step shaky and moving on, and
// closes with a recap (F-613). Every model call that isn't streamed (planning, grading) runs before the
// stream starts, so its failure is a plain HTTP error and nothing has changed.

export type TeachDeps = LlmDeps & {
  db: Db; library: Library; messages: Messages; plans: Plans; ledger: Ledger; learner: Learner; retrieval: Retrieval; teach: TeachStore;
  log?: (msg: string) => void;
};

export type SessionView = Pick<Session, "phase" | "steps" | "step" | "repairs"> & { open: CheckView | null };
export type TeachEvent =
  | { type: "graded"; check: CheckView }
  | { type: "start"; user: Message | null; assistant: Message }
  | { type: "delta"; text: string }
  | { type: "model"; provider: string; model: string }
  | { type: "check"; check: CheckView }
  | { type: "done"; message: Message; session: SessionView }
  | { type: "error"; message: Message; error: string }
  | { type: "progress" };

export const ACTIONS = {
  differently: { label: "Explain it differently", ask: "explain the current step again in a different way: a new angle, example or analogy" },
  simpler: { label: "Simpler, please", ask: "explain the current step more simply: plainer words, smaller pieces, an everyday example" },
  deeper: { label: "Go deeper", ask: "go deeper on the current step: the reasoning behind it, an edge case, how it connects to what came before" },
  example: { label: "Show an example", ask: "show a fully worked example of the current step, step by step" },
} as const;
export type ActionKind = keyof typeof ACTIONS;

export const Answer = z.object({
  checkId: z.string().min(1),
  value: z.union([z.string().max(4000), z.number(), z.array(z.number().int().min(0)).max(7), z.null()]),
  confidence: z.enum(["guess", "unsure", "sure"]).nullable().default(null),
  thinking: z.string().max(4000).default(""),
});
export type Answer = z.infer<typeof Answer>;

const Planned = z.object({
  orientation: z.array(z.number().int()).default([]),
  steps: z.array(z.object({ title: z.string().min(1).max(120), items: z.array(z.number().int()).min(1) })).min(1),
});

const TRANSCRIPT_CHARS = 8000;
const PER_ITEM = 3;
const MAX_REPAIRS = 2;
const PROBE_ITEMS = 6;
// A brief that says the learner has met the subject before.
const KNOWS = /\b(know|knew|familiar|already|studied|took|taken|experience|intermediate|advanced|revis|refresh)/i;
// A right answer marked as a guess counts as half: it doesn't check the item until a follow-up confirms it.
const SCORE: Record<Verdict, number> = { right: 1, partly: 0.5, wrong: 0, unknown: 0 };

// What the next streamed turn is for.
type Turn = {
  // passages: null on a turn that teaches nothing new (the recap), which then cites nothing.
  note: string; passages: Passage[] | null; check: boolean; userText: string | null;
  checkStep: number; checkItems: string[];
  // Applied once the reply finished, so a failed reply changes nothing.
  after?: (session: Session, messageId: string) => void;
};

export function createTeacher(deps: TeachDeps) {
  const { messages, teach, ledger, learner, plans } = deps;

  const load = (chatId: string) => {
    const chat = deps.library.getChat(chatId);
    if (chat.mode !== "teach" || !chat.lessonId) throw new AppError(400, "not_a_lesson", "This chat isn't a lesson.");
    return { chat, lesson: plans.lesson(chat.lessonId), session: teach.session(chatId) };
  };
  const items = (ids: string[]) => ids.map((id) => ledger.get(id));
  const view = (s: Session): SessionView => {
    const open = teach.open(s.chatId);
    return { phase: s.phase, steps: s.steps, step: s.step, repairs: s.repairs, open: open ? checkView(open) : null };
  };

  // The model picked for this chat, then the strong slot's chain, each model on every key, leaving out
  // capped providers. Checked before streaming.
  const chain = (chat: Chat) => {
    const { caps } = deps.settings.get();
    const refs = deps.providers.withKeys([...(chat.model ? [chat.model] : []), ...chainFor(deps.settings, "strong")]).filter((r) => deps.usage.capStatus(caps, r.provider).state !== "blocked");
    if (!refs.length) throw new AppError(429, "cap_reached", "You've reached a token cap. Raise it in Settings or wait for it to reset.");
    return refs;
  };

  // ── What each turn says ──────────────────────────────────────────────────

  const shouldProbe = (chat: Chat, lesson: Lesson) =>
    lesson.requires.length > 0 || KNOWS.test(chat.folderId ? createBriefs(deps.db).nearest(chat.folderId)?.brief.level ?? "" : "");

  // The probe asks about what the lesson builds on, or, when it builds on nothing, about the lesson itself.
  const probeItems = (lesson: Lesson): string[] => {
    const earlier = lesson.requires.flatMap((id) => { try { return plans.lesson(id).items; } catch { return []; } });
    return (earlier.length ? earlier : lesson.items).slice(0, PROBE_ITEMS);
  };

  async function probeTurn(chat: Chat, s: Session, signal?: AbortSignal): Promise<Turn> {
    const ids = probeItems(plans.lesson(s.lessonId));
    const probed = items(ids);
    return {
      note: [
        "Phase: probe. Before teaching, find out what the learner already knows. In two or three sentences say what this lesson covers and that a quick question first will show where to start. Then ask one check on these ideas the lesson builds on (not on anything you explain here):",
        ...itemLines(probed),
      ].join("\n"),
      passages: chat.folderId ? await deps.retrieval.forItems(chat.folderId, probed, 1, signal) : [],
      check: true, userText: null, checkStep: -1, checkItems: ids,
    };
  }

  async function stepTurn(chat: Chat, s: Session, reason: string, signal?: AbortSignal): Promise<Turn> {
    const step = s.steps[s.step]!;
    const taught = items(step.items);
    // Orientation steps right before this one are folded into its opening.
    const orientation = s.steps.slice(0, s.step).filter((x) => x.kind === "orientation" && x.status !== "done");
    const intro = orientation.flatMap((x) => items(x.items));
    const teachSteps = s.steps.filter((x) => x.kind === "teach");
    return {
      note: [
        reason,
        intro.length ? `Open with a sentence or two of orientation (not taught, not checked) covering:\n${itemLines(intro).join("\n")}` : "",
        `Now teach step ${teachSteps.indexOf(step) + 1} of ${teachSteps.length}: "${step.title}". Its items:`,
        ...itemLines(taught),
        "Teach it from the sources below, then end with one check on this step.",
      ].filter(Boolean).join("\n"),
      passages: chat.folderId ? await deps.retrieval.forItems(chat.folderId, taught, PER_ITEM, signal) : [],
      check: true, userText: null, checkStep: s.step, checkItems: step.items,
      after: (session, messageId) => {
        for (const o of orientation) o.status = "done";
        session.steps[session.step]!.status = "current";
        for (const id of [...intro.map((i) => i.id), ...step.items]) learner.record({ itemId: id, kind: "taught", chatId: s.chatId, messageId });
      },
    };
  }

  function recapTurn(s: Session, reason: string): Turn {
    const lesson = plans.lesson(s.lessonId);
    const shaky = s.steps.filter((x) => x.status === "shaky");
    const plan = plans.lessonPlan(lesson.id);
    const next = plan.lessons.find((l) => l.ord > lesson.ord && l.status !== "done");
    return {
      note: [
        reason,
        "Phase: recap. The lesson is over. Write a short recap: what the learner now understands (a few bullets),",
        shaky.length ? `what is still shaky and will come back in review: ${shaky.map((x) => `"${x.title}"`).join(", ")},` : "that nothing is left shaky,",
        next ? `and that the next lesson is "${next.title}".` : "and that this was the last lesson in the plan.",
        "No check.",
      ].join(" "),
      passages: null, check: false, userText: null, checkStep: s.step, checkItems: [],
      after: (session) => {
        session.phase = "done";
        if (lesson.status !== "done") plans.updateLesson(lesson.id, { status: "done" });
      },
    };
  }

  // The turn the session is waiting for: used to start, and to carry on after a failed reply.
  async function nextTurn(chat: Chat, s: Session, reason: string, signal?: AbortSignal): Promise<Turn | null> {
    if (s.phase === "probe") return probeTurn(chat, s, signal);
    if (s.phase === "teach") return stepTurn(chat, s, reason, signal);
    if (s.phase === "recap") return recapTurn(s, reason);
    return null;
  }

  // Moves past the current step: to the next teach step, or to the recap.
  const advance = (s: Session) => {
    s.repairs = 0;
    const next = s.steps.findIndex((x, i) => i > s.step && x.kind === "teach");
    if (next === -1) s.phase = "recap";
    else s.step = next;
  };

  // ── Streaming a turn ─────────────────────────────────────────────────────

  // The lesson so far as one block of text (most recent last), with each check and how it was answered.
  function transcript(chatId: string): string {
    const byMessage = new Map(teach.checks(chatId).map((c) => [c.messageId, c]));
    const text = messages.list(chatId).filter((m) => m.status === "done" && m.content).map((m) => {
      if (m.role === "user") return `Learner: ${m.content}`;
      const c = byMessage.get(m.id);
      if (!c) return `Tutor: ${m.content}`;
      const options = c.spec.type === "mcq" ? ` Options: ${c.spec.options.join(" / ")}` : "";
      const answered = c.result
        ? `\nLearner answered: ${responseText(c.id, c.spec, c.result.value)}${c.result.confidence ? ` (${c.result.confidence})` : ""} — ${c.result.verdict}.${c.result.thinking ? ` Their thinking: ${c.result.thinking}` : ""}`
        : "";
      return `Tutor: ${m.content}\n[Check: ${c.spec.prompt}${options}]${answered}`;
    }).join("\n\n");
    return text.length > TRANSCRIPT_CHARS ? `…${text.slice(-TRANSCRIPT_CHARS)}` : text;
  }

  function system(chat: Chat, s: Session): string {
    const lesson = plans.lesson(s.lessonId);
    const mark = (x: Step, i: number) => (i === s.step && s.phase === "teach" ? "current" : x.status);
    return [
      TEACHER,
      chat.folderId ? briefContext(deps.db, chat.folderId) : "",
      `This lesson: "${lesson.title}". ${lesson.summary}`.trim(),
      "Its steps:",
      ...s.steps.map((x, i) => `${i + 1}. [${x.kind === "orientation" ? "orientation" : mark(x, i)}] ${x.title}`),
    ].filter(Boolean).join("\n");
  }

  const sourcesOf = (passages: Passage[]): Source[] =>
    passages.map((p) => ({ materialId: p.materialId, materialName: p.materialName, loc: p.loc, locTo: p.locTo, headings: p.headings }));

  // Text from `<check` on is held back while streaming; a partial "<che" at the end waits for the next delta.
  const visibleEnd = (text: string) => {
    const at = text.indexOf("<check");
    if (at !== -1) return at;
    for (let n = Math.min(5, text.length); n > 0; n--) if ("<check".startsWith(text.slice(-n))) return text.length - n;
    return text.length;
  };

  async function readCheck(raw: string, body: string, folderId: string | null, signal?: AbortSignal): Promise<CheckSpec> {
    const inside = raw.match(/<check>([\s\S]*?)(?:<\/check>|$)/)?.[1];
    if (inside) {
      try {
        const parsed = CheckSpec.safeParse(parseJsonReply(inside));
        if (parsed.success) return parsed.data;
      } catch { /* written again below */ }
    }
    // Missing or malformed: ask for it on its own, validated (completeJson retries once with the error).
    return completeJson(deps, CheckSpec, {
      slot: "strong", role: "teacher", folderId, signal, maxTokens: 800,
      system: TEACHER,
      prompt: `Write the check for the end of this lesson text, as the JSON object only (one of the check formats in your instructions):\n\n${body.slice(-6000)}`,
    });
  }

  async function* speak(chat: Chat, s: Session, turn: Turn, refs: ReturnType<typeof chain>, signal: AbortSignal): AsyncGenerator<TeachEvent> {
    const user = turn.userText ? messages.add({ chatId: chat.id, role: "user", content: turn.userText, status: "done" }) : null;
    const assistant = messages.add({ chatId: chat.id, role: "assistant", content: "", status: "streaming", provider: refs[0]!.provider, model: refs[0]!.id });
    deps.library.touchChat(chat.id);
    const sources = sourcesOf(turn.passages ?? []);
    if (sources.length) messages.setSources(assistant.id, sources);
    yield { type: "start", user, assistant: { ...assistant, sources: sources.length ? sources : null } };

    const sys = system(chat, s);
    const so_far = transcript(chat.id);
    const prompt = [
      so_far ? `The lesson so far:\n\n${so_far}` : "The lesson is just starting.",
      `Director's note for this turn (not shown to the learner):\n${turn.note}${turn.check ? "" : "\nDo not write a check this turn."}`,
      turn.passages ? sourceBlock(turn.passages) : "No sources this turn: cite nothing.",
    ].join("\n\n---\n\n");

    let raw = "";
    let shown = 0;
    let reported: Usage | null = null;
    let answering = refs[0]!;
    const record = () => deps.usage.record({
      provider: answering.provider, model: answering.id, role: "teacher", chatId: chat.id, folderId: chat.folderId,
      usage: reported ?? { input: estimateTokens(sys + prompt), output: estimateTokens(raw), cached: 0, reasoning: 0 },
      estimated: !reported,
    });
    const fail = (err: unknown): TeachEvent => {
      const error = err instanceof Error ? err.message : String(err);
      const body = raw.slice(0, visibleEnd(raw)).trimEnd();
      messages.finish(assistant.id, body, "error", error);
      return { type: "error", message: { ...assistant, content: body, status: "error", error }, error };
    };

    try {
      for (let i = 0; ; i++) {
        answering = refs[i]!;
        if (i > 0) {
          messages.setModel(assistant.id, answering.provider, answering.id);
          yield { type: "model", provider: answering.provider, model: answering.id };
        }
        try {
          for await (const event of deps.providers.stream(answering, { system: sys, messages: [{ role: "user", content: prompt }], signal })) {
            if (event.type !== "text") { reported = event.usage; continue; }
            raw += event.text;
            const end = visibleEnd(raw);
            if (end > shown) {
              yield { type: "delta", text: raw.slice(shown, end) };
              shown = end;
            }
          }
          break;
        } catch (err) {
          const retry = err instanceof ProviderError && (err.status === 429 || err.status >= 500 || err.status === 0);
          if (raw || signal.aborted || !retry || i === refs.length - 1) throw err;
          deps.log?.(`${deps.providers.describe(answering)} failed (${err instanceof Error ? err.message : err}); trying ${deps.providers.describe(refs[i + 1]!)}`);
        }
      }
    } catch (err) {
      if (raw) record();
      if (signal.aborted) { messages.finish(assistant.id, raw.slice(0, visibleEnd(raw)).trimEnd(), "aborted"); return; }
      yield fail(err);
      return;
    }
    record();

    const cut = raw.indexOf("<check");
    const body = (cut === -1 ? raw : raw.slice(0, cut)).trimEnd();
    // A tail the model wrote after a stray "<che…" that wasn't a check is shown now.
    if (cut === -1 && shown < raw.length) yield { type: "delta", text: raw.slice(shown) };
    let check: Check | null = null;
    if (turn.check) {
      try {
        const spec = await readCheck(cut === -1 ? "" : raw.slice(cut), body, chat.folderId, signal);
        check = teach.addCheck({ chatId: chat.id, messageId: assistant.id, step: turn.checkStep, items: turn.checkItems, spec });
      } catch (err) {
        yield fail(new Error(`The check question couldn't be written (${err instanceof Error ? err.message : err}). Try again.`));
        return;
      }
    }
    messages.finish(assistant.id, body, "done");
    turn.after?.(s, assistant.id);
    teach.save(s);
    if (check) yield { type: "check", check: checkView(check) };
    if (turn.after) yield { type: "progress" };
    yield {
      type: "done",
      message: { ...assistant, provider: answering.provider, model: answering.id, content: body, status: "done", sources: sources.length ? sources : null },
      session: view(s),
    };
  }

  // ── Entry points: each checks and prepares first, then returns the stream ──

  const teacher = {
    view(chatId: string): { session: SessionView | null; checks: CheckView[] } {
      const { session } = load(chatId);
      return { session: session ? view(session) : null, checks: teach.checks(chatId).map(checkView) };
    },

    // Starts the lesson (planning its steps), or carries on from where it stopped.
    async start(chatId: string, signal: AbortSignal): Promise<AsyncGenerator<TeachEvent>> {
      const { chat, lesson, session } = load(chatId);
      let s = session;
      const refs = chain(chat);
      if (!s) {
        const steps = await planSteps(chat, lesson, signal);
        s = teach.create({ chatId, lessonId: lesson.id, phase: shouldProbe(chat, lesson) ? "probe" : "teach", steps, step: 0, probe: [] });
        if (s.phase === "teach") { advanceToFirst(s); teach.save(s); }
        if (lesson.status === "todo") plans.updateLesson(lesson.id, { status: "in_progress" });
      }
      if (teach.open(chatId)) throw new AppError(409, "check_open", "Answer the open question first.");
      const turn = await nextTurn(chat, s, session ? "Carry on where the lesson stopped." : "Begin the lesson.", signal);
      if (!turn) throw new AppError(409, "lesson_done", "This lesson is finished.");
      return speak(chat, s, turn, refs, signal);
    },

    // Grades an answer, records it, decides the next move and streams the teacher's reply to it.
    async answer(chatId: string, a: Answer, signal: AbortSignal): Promise<AsyncGenerator<TeachEvent>> {
      const { chat, session: s } = load(chatId);
      const open = teach.open(chatId);
      if (!s || !open || open.id !== a.checkId) throw new AppError(409, "check_closed", "That question has already been answered.");
      const refs = chain(chat);
      const result = await grade(chat, open, a, signal);
      teach.answer(open.id, result);
      const graded = { ...open, result };

      const probing = open.step === -1;
      const guessed = result.verdict === "right" && a.confidence === "guess";
      for (const itemId of open.items) {
        learner.record({
          itemId, kind: probing ? "probe" : "check", score: guessed ? 0.5 : SCORE[result.verdict], confidence: a.confidence,
          withHelp: false, chatId, messageId: open.messageId, ref: open.id,
        });
      }

      let reason: string;
      const said = `The learner's answer was ${result.verdict}${result.feedback ? ` (${result.feedback})` : ""}.`;
      if (probing) {
        s.probe.push({ prompt: open.spec.prompt, verdict: result.verdict });
        s.phase = "teach";
        advanceToFirst(s);
        reason = `Probe result: ${said} ${result.verdict === "right" ? "They know the groundwork: keep the basics brief and move a little faster." : "Go gently: recap the groundwork the probe touched in a few sentences before building on it."}`;
      } else if (result.verdict === "right" && !(guessed && !followedUp(chatId, open))) {
        s.steps[s.step]!.status = "done";
        advance(s);
        reason = `${said} Confirm it in one sentence with a detail that deepens it, then move on.`;
      } else if (result.verdict === "right") {
        reason = `${said} But they marked it as a guess. Confirm briefly, then ask one quick follow-up check on the same idea from another angle. Teach nothing new.`;
      } else if (s.repairs < MAX_REPAIRS) {
        s.repairs++;
        reason = `Repair ${s.repairs} of ${MAX_REPAIRS}. ${said} Say plainly what was right and what wasn't, explain the idea again in a different way than before (a new example or analogy), then ask a new check on the same idea. Don't move on.`;
      } else {
        s.steps[s.step]!.status = "shaky";
        advance(s);
        reason = `${said} After ${MAX_REPAIRS} repairs the learner still hasn't got it. Give the right answer clearly in two or three sentences, say it'll come back in the recap and in review, then move on.`;
      }
      teach.save(s);

      const turn = await nextTurn(chat, s, reason, signal);
      // A follow-up or repair checks the same step again, without teaching it as new.
      if (turn && s.phase === "teach" && s.step === open.step) delete turn.after;
      return (async function* () {
        yield { type: "graded", check: checkView(graded) } satisfies TeachEvent;
        yield { type: "progress" } satisfies TeachEvent;
        if (turn) yield* speak(chat, s, turn, refs, signal);
      })();
    },

    // Quick actions on the current step (F-611): re-explain without moving on.
    async action(chatId: string, kind: ActionKind, signal: AbortSignal): Promise<AsyncGenerator<TeachEvent>> {
      const { chat, session: s } = load(chatId);
      if (!s || s.phase !== "teach") throw new AppError(409, "not_teaching", "Quick actions work while a step is being taught.");
      const refs = chain(chat);
      const step = s.steps[s.step]!;
      const open = !!teach.open(chatId);
      const turn: Turn = {
        note: `The learner asked you to ${ACTIONS[kind].ask}: "${step.title}". Do that without moving on.${open ? " The open check still stands, so don't write a new one." : " End with one check on this step."}`,
        passages: chat.folderId ? await deps.retrieval.forItems(chat.folderId, items(step.items), PER_ITEM, signal) : [],
        check: !open, userText: ACTIONS[kind].label, checkStep: s.step, checkItems: step.items,
      };
      return speak(chat, s, turn, refs, signal);
    },

    // A question mid-lesson: answered from the folder's sources, then back to the lesson.
    async ask(chatId: string, text: string, signal: AbortSignal): Promise<AsyncGenerator<TeachEvent>> {
      const { chat, session: s } = load(chatId);
      const question = text.trim();
      if (!question) throw new AppError(400, "empty_message", "Type a question first.");
      if (!s) throw new AppError(409, "not_started", "Start the lesson first.");
      const refs = chain(chat);
      const turn: Turn = {
        note: `The learner asked a question mid-lesson. Answer it briefly from the sources, then say where the lesson picks up again. Don't write a check; the lesson carries on as it was.`,
        passages: chat.folderId ? await deps.retrieval.retrieve(chat.folderId, question, 5, signal) : [],
        check: false, userText: question, checkStep: s.step, checkItems: [],
      };
      return speak(chat, s, turn, refs, signal);
    },
  };

  // A right guess is followed up once per step: the check before this one, on the same step, was that follow-up's cause.
  function followedUp(chatId: string, current: Check): boolean {
    const earlier = teach.checks(chatId).filter((c) => c.step === current.step && c.id !== current.id && c.result);
    return earlier.some((c) => c.result!.verdict === "right" && c.result!.confidence === "guess");
  }

  // Teaching starts at the first teach step (orientation before it is folded into that turn).
  function advanceToFirst(s: Session) {
    const first = s.steps.findIndex((x) => x.kind === "teach");
    if (first === -1) s.phase = "recap";
    else s.step = first;
  }

  async function grade(chat: Chat, check: Check, a: Answer, signal: AbortSignal): Promise<Result> {
    const blank = a.value === null || (typeof a.value === "string" && !a.value.trim());
    const value = blank ? null : a.value;
    const exact = gradeExact(check.id, check.spec, value);
    const judged = exact
      ? { verdict: exact, feedback: "" }
      : await gradeWithModel(deps, check.spec, String(value), chat.folderId);
    return {
      value, confidence: a.confidence as Confidence | null, thinking: a.thinking.trim(),
      verdict: judged.verdict, feedback: judged.feedback, answer: answerText(check.spec), why: check.spec.why,
    };
  }

  // Splits the lesson's items into steps with the strong model; one item per step if its plan doesn't cover every item once.
  async function planSteps(chat: Chat, lesson: Lesson, signal: AbortSignal): Promise<Step[]> {
    const all = items(lesson.items).filter((i) => i.mark !== "known" && i.mark !== "skip" && i.mark !== "out_of_scope");
    if (!all.length) return [];
    const fallback = (): Step[] => all.map((i) => ({ title: i.title, kind: "teach", items: [i.id], status: "upcoming" }));
    let planned: z.infer<typeof Planned>;
    try {
      planned = await completeJson(deps, Planned, { slot: "strong", role: "teacher", folderId: chat.folderId, system: PLANNER, prompt: planPrompt(lesson.title, all), maxTokens: 1500, signal });
    } catch (err) {
      if (signal.aborted) throw err;
      deps.log?.(`Lesson step planning failed, teaching one item per step: ${err instanceof Error ? err.message : err}`);
      return fallback();
    }
    const numbers = [...planned.orientation, ...planned.steps.flatMap((x) => x.items)];
    const covers = numbers.length === all.length && new Set(numbers).size === all.length && numbers.every((n) => n >= 1 && n <= all.length);
    if (!covers) return fallback();
    const ids = (ns: number[]) => ns.map((n) => all[n - 1]!.id);
    const orientation: Step[] = planned.orientation.length
      ? [{ title: "Orientation", kind: "orientation", items: ids(planned.orientation), status: "upcoming" }]
      : [];
    return [...orientation, ...planned.steps.map((x): Step => ({ title: x.title, kind: "teach", items: ids(x.items), status: "upcoming" }))];
  }

  return teacher;
}

export type Teacher = ReturnType<typeof createTeacher>;
