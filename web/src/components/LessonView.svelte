<script lang="ts">
  import { tick, untrack } from "svelte";
  import { api, ApiError, type ActionKind, type Answer, type Chat, type CheckView, type Message, type SessionView, type Source, type TeachEvent } from "../lib/api.ts";
  import { attempt, refreshLibrary, toast } from "../lib/state.svelte.ts";
  import CheckCard from "./CheckCard.svelte";
  import Composer from "./Composer.svelte";
  import Icon from "./Icon.svelte";
  import Markdown from "./Markdown.svelte";

  // A lesson (Phase 4, §6): the teacher writes a lesson document (F-612), the learner's words are note
  // cards, each step ends in a check card, and a session plan sits on the right (F-603).
  let { chat, messages = $bindable(), onprogress, oncap }: {
    chat: Chat; messages: Message[]; onprogress: () => void; oncap: (err: ApiError) => void;
  } = $props();

  let session = $state<SessionView | null>(null);
  let checks = $state<CheckView[]>([]);
  let loaded = $state(false);
  let controller = $state<AbortController | null>(null);
  let draft = $state("");
  let scroller = $state<HTMLElement>();
  let pinned = true;
  // The plan panel overlays the lesson on narrow screens, so there it starts closed.
  let planOpen = $state(window.innerWidth > 1100);

  $effect(() => {
    const chatId = chat.id;
    untrack(() => {
      loaded = false;
      attempt(() => api.teach(chatId)).then(async (view) => {
        if (!view || chatId !== chat.id) return;
        session = view.session;
        checks = view.checks;
        loaded = true;
        await scrollToEnd();
      });
    });
    return () => controller?.abort();
  });

  async function scrollToEnd() {
    await tick();
    if (pinned && scroller) scroller.scrollTop = scroller.scrollHeight;
  }
  const onscroll = () => { if (scroller) pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80; };

  const busy = $derived(controller !== null);
  const byMessage = $derived(new Map(checks.map((c) => [c.messageId, c])));
  const open = $derived(session?.open ?? null);
  const teaching = $derived(session?.phase === "teach");
  // Where the dividers go (F-602): the first reply after the probe, and the recap.
  const probeMessage = $derived(checks.find((c) => c.step === -1)?.messageId ?? null);
  const firstTeach = $derived.by(() => {
    if (!probeMessage) return null;
    const at = messages.findIndex((m) => m.id === probeMessage);
    return messages.slice(at + 1).find((m) => m.role === "assistant")?.id ?? null;
  });
  const recapMessage = $derived(session?.phase === "done" ? messages.findLast((m) => m.role === "assistant" && m.status === "done")?.id ?? null : null);
  const lastAssistant = $derived(messages.findLast((m) => m.role === "assistant")?.id ?? null);

  // Runs one streamed move: the reply grows in place, and the session and checks update as events arrive.
  async function run(go: (onEvent: (e: TeachEvent) => void, signal: AbortSignal) => Promise<void>) {
    if (busy) return;
    const ctrl = new AbortController();
    controller = ctrl;
    pinned = true;
    let assistantId = "";
    const patch = (fn: (m: Message) => Message) => { messages = messages.map((m) => (m.id === assistantId ? fn(m) : m)); };
    try {
      await go((event) => {
        if (event.type === "graded") checks = checks.map((c) => (c.id === event.check.id ? event.check : c));
        else if (event.type === "start") {
          assistantId = event.assistant.id;
          messages = [...messages, ...(event.user ? [event.user] : []), event.assistant];
          draft = "";
        } else if (event.type === "model") patch((m) => ({ ...m, provider: event.provider, model: event.model }));
        else if (event.type === "delta") patch((m) => ({ ...m, content: m.content + event.text }));
        else if (event.type === "check") checks = [...checks, event.check];
        else if (event.type === "done") { patch(() => event.message); session = event.session; }
        else if (event.type === "error") patch(() => event.message);
        else if (event.type === "progress") onprogress();
        scrollToEnd();
      }, ctrl.signal);
    } catch (err) {
      if (ctrl.signal.aborted) patch((m) => ({ ...m, status: "aborted" }));
      else if (err instanceof ApiError && err.code === "cap_reached") oncap(err);
      else toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      controller = null;
      // A stopped or failed reply leaves the session as it was; reload it so the controls match.
      const view = await api.teach(chat.id).catch(() => null);
      if (view) { session = view.session; checks = view.checks; }
      refreshLibrary();
    }
  }

  // After a question mid-lesson the open check is further up; this brings it back into view.
  const toOpen = () => document.getElementById(`check-${open?.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });

  const start = () => run((on, signal) => api.teachStart(chat.id, on, signal));
  const answer = (check: CheckView, a: Omit<Answer, "checkId">) => run((on, signal) => api.teachAnswer(chat.id, { ...a, checkId: check.id }, on, signal));
  const action = (kind: ActionKind) => run((on, signal) => api.teachAction(chat.id, kind, on, signal));
  const ask = (text: string) => run((on, signal) => api.teachAsk(chat.id, text, on, signal));

  // [n] (or [1, 3]) in a reply links to the passages it cites, in the material viewer.
  const locLabel = (s: Source) => (s.loc === s.locTo ? `${s.loc}` : `${s.loc}–${s.locTo}`);
  const cited = (content: string, sources: Source[] | null) => !sources?.length ? content
    : content.replace(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?!\()/g, (all, list: string) => {
      const ns = list.split(",").map((n) => Number(n.trim()));
      if (!ns.every((n) => sources[n - 1])) return all;
      return ns.map((n) => {
        const s = sources[n - 1]!;
        return `[\\[${n}\\]](#/material/${s.materialId}/${s.loc} "${s.materialName.replace(/"/g, "'")} · ${locLabel(s)}")`;
      }).join("");
    });

  // Quick actions on the step being taught (F-611).
  const ACTIONS: Record<ActionKind, string> = { differently: "Explain differently", simpler: "Simpler", deeper: "Deeper", example: "Show an example" };
  const STEP_ICON = { done: "check", shaky: "warning", current: "dots", upcoming: "" } as const;
</script>

<div class="lesson">
  <div class="scroll" bind:this={scroller} {onscroll}>
    <div class="page doc">
      {#if loaded && !session && !messages.length}
        <div class="intro">
          <p class="eyebrow">Lesson</p>
          <h1 class="display-md">{chat.title}</h1>
          <p class="body muted">The lesson teaches one step at a time from your material, checks each step with a question, and goes over anything that didn't land before moving on.</p>
          <div><button type="button" class="btn btn--primary" disabled={busy} onclick={start}><Icon name="play" size="sm" />Start lesson</button></div>
        </div>
      {/if}

      {#each messages as message (message.id)}
        {#if message.id === firstTeach}<div class="divider"><span>Teaching</span></div>{/if}
        {#if message.id === recapMessage}<div class="divider"><span>Recap</span></div>{/if}
        {#if message.id === probeMessage}<div class="divider"><span>Probe</span></div>{/if}
        {#if message.role === "user"}
          <aside class="note"><p class="eyebrow">You</p><p>{message.content}</p></aside>
        {:else}
          {@const check = byMessage.get(message.id)}
          <article class="block" aria-busy={message.status === "streaming"}>
            {#if message.content}
              <Markdown source={cited(message.content, message.sources)} streaming={message.status === "streaming"} />
            {:else if message.status === "streaming"}
              <span class="drop drop--pulse" aria-label="Writing"></span>
            {/if}
            {#if message.sources?.length && message.status !== "streaming"}
              <details class="sources">
                <summary class="caption muted">{message.sources.length} source{message.sources.length === 1 ? "" : "s"}</summary>
                <ol>
                  {#each message.sources as s, i (i)}
                    <li><a href="#/material/{s.materialId}/{s.loc}"><span class="mono faint">[{i + 1}]</span> {s.materialName} · {locLabel(s)}{#if s.headings.length}<span class="faint"> · {s.headings.at(-1)}</span>{/if}</a></li>
                  {/each}
                </ol>
              </details>
            {/if}
            {#if message.status === "error"}
              <div class="banner banner--danger"><Icon name="warning" /><span>{message.error}</span></div>
            {:else if message.status === "aborted"}
              <p class="caption faint">{message.error ?? "Stopped."}</p>
            {/if}
            {#if check}
              <div id="check-{check.id}"><CheckCard {check} {busy} probe={check.step === -1} onanswer={(a) => answer(check, a)} /></div>
            {/if}
            {#if teaching && message.id === lastAssistant && message.status === "done" && !busy}
              <div class="actions" role="group" aria-label="Ask the teacher to">
                {#each Object.entries(ACTIONS) as [kind, label] (kind)}
                  <button type="button" class="btn btn--ghost btn--sm" onclick={() => action(kind as ActionKind)}>{label}</button>
                {/each}
              </div>
            {/if}
          </article>
        {/if}
      {/each}

      {#if open && open.messageId !== lastAssistant && !busy}
        <div><button type="button" class="btn btn--secondary btn--sm" onclick={toOpen}><Icon name="target" size="sm" />Back to the question</button></div>
      {/if}
      {#if session && session.phase !== "done" && !open && !busy}
        <div><button type="button" class="btn btn--secondary" onclick={start}><Icon name="refresh" size="sm" />Continue the lesson</button></div>
      {/if}
      {#if session?.phase === "done"}
        <p class="caption muted end">Lesson finished. Steps marked shaky come back in review.</p>
      {/if}
    </div>
  </div>

  {#if session}
    <aside class="plan" class:is-closed={!planOpen} aria-label="Session plan">
      <div class="plan__head">
        {#if planOpen}<p class="eyebrow">Session plan</p>{/if}
        <button type="button" class="btn btn--ghost btn--icon btn--sm" aria-expanded={planOpen} aria-label={planOpen ? "Hide session plan" : "Show session plan"}
          data-tip={planOpen ? "Hide plan" : "Session plan"} onclick={() => (planOpen = !planOpen)}><Icon name="panel" size="sm" /></button>
      </div>
      {#if planOpen}
        <ol class="steps">
          {#if probeMessage}<li class="is-done"><span class="steps__mark"><Icon name="check" size="sm" /></span>Where to start</li>{/if}
          {#each session.steps as step, i (i)}
            {@const state = session.phase === "teach" && i === session.step ? "current" : step.status}
            <li class="is-{state}" class:is-orientation={step.kind === "orientation"}>
              <span class="steps__mark">{#if STEP_ICON[state]}<Icon name={STEP_ICON[state]} size="sm" />{/if}</span>
              <span>{step.title}{#if state === "shaky"}<span class="caption faint">&nbsp;· shaky</span>{/if}{#if state === "current" && session.repairs}<span class="caption faint">&nbsp;· try {session.repairs + 1}</span>{/if}</span>
            </li>
          {/each}
          <li class="is-{session.phase === 'done' ? 'done' : session.phase === 'recap' ? 'current' : 'upcoming'}">
            <span class="steps__mark">{#if session.phase === "done"}<Icon name="check" size="sm" />{/if}</span>Recap
          </li>
        </ol>
      {/if}
    </aside>
  {/if}
</div>

{#if session}
  <div class="composer-wrap">
    <Composer bind:value={draft} {busy} onsend={ask} onstop={() => controller?.abort()} placeholder="Ask about this lesson…" />
  </div>
{/if}

<style>
  .lesson { flex: 1; min-height: 0; display: flex; }
  .lesson > .scroll { flex: 1; min-width: 0; }
  .doc { display: grid; gap: var(--s-5); padding-bottom: var(--s-8); }
  .intro { display: grid; gap: var(--s-3); padding-top: 10vh; max-width: 56ch; }
  .block { display: grid; gap: var(--s-4); max-width: 72ch; min-width: 0; }
  .block .banner span { min-width: 0; overflow-wrap: anywhere; }
  .note { justify-self: start; max-width: min(72ch, 100%); padding: var(--s-2) var(--s-4) var(--s-3); border-left: 3px solid var(--accent); background: var(--surface-sunken); border-radius: 0 var(--r-sm) var(--r-sm) 0; display: grid; gap: 2px; }
  .note p:last-child { white-space: pre-wrap; overflow-wrap: anywhere; }
  .divider { display: flex; align-items: center; gap: var(--s-3); color: var(--text-faint); font-size: var(--t-eyebrow); letter-spacing: .08em; text-transform: uppercase; }
  .divider::before, .divider::after { content: ""; flex: 1; height: 1px; background: var(--border); }
  .sources summary { cursor: pointer; width: max-content; }
  .sources ol { list-style: none; padding: var(--s-2) 0 0; display: grid; gap: 2px; font-size: var(--t-body-sm); }
  .sources a { color: var(--text-muted); }
  .sources a:hover { color: var(--text); }
  .actions { display: flex; flex-wrap: wrap; gap: var(--s-1); margin-left: calc(-1 * var(--s-2)); }
  .end { text-align: center; }
  .doc :global(a.cite) { color: var(--accent); text-decoration: none; font-size: .8em; vertical-align: super; line-height: 0; padding: 0 1px; }
  .doc :global(a.cite:hover) { text-decoration: underline; }
  .plan { width: 248px; flex: none; border-left: 1px solid var(--border); padding: var(--s-3) var(--s-4) var(--s-4); display: grid; align-content: start; gap: var(--s-3); overflow-y: auto; }
  .plan.is-closed { width: 48px; padding: var(--s-3) var(--s-2); }
  .plan__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); min-height: 28px; }
  .steps { list-style: none; padding: 0; display: grid; gap: var(--s-1); font-size: var(--t-body-sm); }
  .steps li { display: flex; gap: var(--s-2); align-items: flex-start; padding: var(--s-1) var(--s-2); border-radius: var(--r-xs); color: var(--text-faint); }
  .steps li.is-done { color: var(--text-muted); }
  .steps li.is-current { color: var(--text); background: var(--accent-wash); font-weight: 500; }
  .steps li.is-shaky { color: var(--text-muted); }
  .steps li.is-shaky .steps__mark { color: var(--warning); }
  .steps li.is-done .steps__mark, .steps li.is-current .steps__mark { color: var(--accent); }
  .steps li.is-orientation { font-style: italic; }
  .steps__mark { width: 16px; flex: none; display: inline-flex; padding-top: 2px; }
  @media (max-width: 1100px) { .plan:not(.is-closed) { position: absolute; right: 0; top: 0; bottom: 0; background: var(--surface); z-index: 5; box-shadow: var(--shadow-float); } .lesson { position: relative; } }
</style>
