<script lang="ts">
  import ActivityDock from "./ActivityDock.svelte";
  import SoundButton from "./SoundButton.svelte";
  import { tick, untrack } from "svelte";
  import { api, ApiError, type CapStatus, type Chat, type Item, type LessonDetail, type Message, type Meter, type ModelRef } from "../lib/api.ts";
  import { app, attempt, folderPath, library, loadModels, nav, pending, refreshLibrary, toast } from "../lib/state.svelte.ts";
  import Composer from "./Composer.svelte";
  import Dialog from "./Dialog.svelte";
  import Icon from "./Icon.svelte";
  import Markdown from "./Markdown.svelte";
  import ModelSelect from "./ModelSelect.svelte";

  let { id }: { id: string } = $props();

  let chat = $state<Chat | null>(null);
  let messages = $state<Message[]>([]);
  let meter = $state<Meter | null>(null);
  let model = $state<ModelRef | null>(null);
  let controller = $state<AbortController | null>(null);
  let capWarn = $state<CapStatus | null>(null);
  let capHit = $state<{ open: boolean; status: CapStatus | null }>({ open: false, status: null });
  let draft = $state("");
  let editingTitle = $state(false);
  let titleDraft = $state("");
  let scroller = $state<HTMLElement>();
  let pinned = true;

  const fmt = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
  const path = $derived(chat ? folderPath(chat.folderId) : []);
  const contextPct = $derived(meter?.contextWindow ? Math.min(100, (meter.context / meter.contextWindow) * 100) : null);

  // Load the chat whenever the route points at a different one.
  $effect(() => {
    const chatId = id;
    untrack(() => controller?.abort());
    chat = null;
    capWarn = null;
    attempt(() => api.chat(chatId)).then(async (data) => {
      if (!data || chatId !== id) return;
      chat = data.chat;
      messages = data.messages;
      meter = data.meter;
      model = data.chat.model ?? app.settings?.models.strong ?? null;
      pinned = true;
      await scrollToEnd();
      if (pending.chatId === chatId) {
        const text = pending.text;
        if (pending.model) model = pending.model;
        pending.chatId = null;
        pending.model = null;
        send(text);
      }
    });
  });

  $effect(() => { loadModels(); });

  // A lesson chat shows its lesson: where it sits in the plan and how far its items and its unit have got.
  let lesson = $state<LessonDetail | null>(null);
  const loadLesson = async (lessonId: string | null) => {
    const detail = lessonId ? await api.lesson(lessonId).catch(() => null) : null;
    if (chat?.lessonId === lessonId) lesson = detail;
  };
  $effect(() => { const lessonId = chat?.lessonId ?? null; untrack(() => loadLesson(lessonId)); });
  const learned = (item: Item) => item.status !== "pending" && item.status !== "planned";
  const itemState = (item: Item) => (item.status === "checked" || item.status === "mastered" ? "checked" : learned(item) ? "taught" : "todo");
  const taught = $derived(lesson?.items.filter(learned).length ?? 0);
  const checked = $derived(lesson?.items.filter((i) => itemState(i) === "checked").length ?? 0);

  async function finishLesson() {
    if (!lesson) return;
    if (await attempt(() => api.updateLesson(lesson!.lesson.id, { status: "done" }))) loadLesson(lesson.lesson.id);
  }

  async function scrollToEnd() {
    await tick();
    if (pinned && scroller) scroller.scrollTop = scroller.scrollHeight;
  }
  const onscroll = () => {
    if (scroller) pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  };

  async function send(text: string) {
    if (!chat || controller) return;
    const ctrl = new AbortController();
    controller = ctrl;
    pinned = true;
    let assistantId = "";
    const patch = (fn: (m: Message) => Message) => { messages = messages.map((m) => (m.id === assistantId ? fn(m) : m)); };
    try {
      await api.send(chat.id, text, model ?? undefined, (event) => {
        if (event.type === "start") {
          assistantId = event.assistant.id;
          messages = [...messages, event.user, event.assistant];
          draft = "";
        } else if (event.type === "model") {
          patch((m) => ({ ...m, provider: event.provider, model: event.model }));
        } else if (event.type === "delta") {
          patch((m) => ({ ...m, content: m.content + event.text }));
        } else if (event.type === "done") {
          patch(() => event.message);
          meter = event.meter;
          capWarn = event.cap.state === "warn" ? event.cap : null;
          if (chat?.lessonId) loadLesson(chat.lessonId);
        } else if (event.type === "error") {
          patch(() => event.message);
        } else if (event.type === "title" && chat) {
          chat.title = event.title;
          const entry = library.chats.find((c) => c.id === chat!.id);
          if (entry) entry.title = event.title;
        }
        scrollToEnd();
      }, ctrl.signal);
    } catch (err) {
      if (ctrl.signal.aborted) {
        patch((m) => ({ ...m, status: "aborted" }));
      } else if (err instanceof ApiError && err.code === "cap_reached") {
        capHit = { open: true, status: err.details as CapStatus };
      } else if (err instanceof ApiError && err.code === "no_model") {
        toast("Pick a model first: add a provider key in Settings.", "error");
      } else {
        toast(err instanceof Error ? err.message : String(err), "error");
      }
    } finally {
      controller = null;
      refreshLibrary();
    }
  }

  async function pickModel(ref: ModelRef) {
    model = ref;
    if (chat) await attempt(() => api.updateChat(chat!.id, { model: ref }));
  }

  async function saveTitle() {
    editingTitle = false;
    if (!chat || !titleDraft.trim() || titleDraft.trim() === chat.title) return;
    const updated = await attempt(() => api.updateChat(chat!.id, { title: titleDraft }));
    if (updated) {
      chat = updated;
      await refreshLibrary();
    }
  }

  // Puts the question behind a failed or stopped reply back in the composer.
  const retry = (index: number) => {
    const question = messages.slice(0, index).findLast((m) => m.role === "user");
    if (question) draft = question.content;
  };

  const periodLabel = (c: CapStatus["checks"][number]) => `${c.period === "daily" ? "Today" : "This month"} · ${c.scope}`;
</script>

<header class="topbar">
  <button type="button" class="btn btn--ghost btn--icon btn--sm topbar__menu" aria-label="Open menu" onclick={() => (nav.sidebarOpen = true)}><Icon name="sidebar" size="sm" /></button>
  <nav class="topbar__crumb" aria-label="Location">
    {#each path as folder (folder.id)}<span>{folder.name}</span><Icon name="chevron-right" size="sm" />{/each}
    {#if chat}
      {#if editingTitle}
        <!-- svelte-ignore a11y_autofocus -->
        <input class="input title-input" bind:value={titleDraft} autofocus aria-label="Chat name" maxlength="120"
          onblur={saveTitle} onkeydown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") editingTitle = false; }} />
      {:else}
        <button type="button" class="title-btn" data-tip="Rename" onclick={() => { titleDraft = chat!.title; editingTitle = true; }}><strong>{chat.title}</strong></button>
      {/if}
    {/if}
  </nav>
  <span class="topbar__spacer"></span>
  {#if meter}
    <span class="meter" data-tip="Tokens used in this chat{contextPct !== null ? ` · last prompt filled ${contextPct.toFixed(0)} % of the model's context` : ''}">
      {fmt.format(meter.input + meter.output)} tokens
      {#if contextPct !== null}<span class="meter__track"><span style:--v="{contextPct}%"></span></span>{/if}
    </span>
  {/if}
  <SoundButton />
  <ActivityDock />
</header>

{#if lesson}
  <section class="lesson-bar" aria-label="Lesson">
    <div class="lesson-bar__inner">
      <div class="lesson-bar__where">
        <span class="eyebrow">Unit {lesson.unitNo} · Lesson {lesson.index} of {lesson.total}</span>
        <span class="body-sm lesson-bar__unit" title={lesson.unit.title}>{lesson.unit.title}</span>
      </div>
      <div class="lesson-bar__progress">
        <span class="lesson-bar__items" role="img" aria-label="{taught} of {lesson.items.length} items taught, {checked} checked">
          {#each lesson.items as item (item.id)}<i class="is-{itemState(item)}" title="{item.title} · {itemState(item) === 'todo' ? 'not taught yet' : itemState(item)}"></i>{/each}
        </span>
        <span class="caption muted">{taught}/{lesson.items.length} taught · {checked} checked · unit {lesson.unitLessons.done}/{lesson.unitLessons.total} lessons done</span>
      </div>
      <div class="lesson-bar__actions">
        {#if lesson.lesson.status === "done"}
          <span class="status status--done"><i></i>Done</span>
        {:else}
          <button type="button" class="btn btn--ghost btn--sm" onclick={finishLesson}><Icon name="check" size="sm" />Mark done</button>
        {/if}
        <a class="btn btn--ghost btn--sm" href="#/folder/{lesson.folderId}/plan">Plan</a>
      </div>
    </div>
  </section>
{/if}

<div class="scroll" bind:this={scroller} {onscroll}>
  <div class="page thread">
    {#if chat && !messages.length}
      <div class="empty">
        <p class="eyebrow">Ask</p>
        <h1 class="display-md">What are you <em>studying?</em></h1>
        <p class="body muted">Ask a question, paste a problem, or have a concept explained. Maths, code and tables render as you'd expect.</p>
      </div>
    {/if}
    {#each messages as message, i (message.id)}
      {#if message.role === "user"}
        <div class="turn turn--user"><p>{message.content}</p></div>
      {:else}
        <article class="turn turn--assistant" aria-busy={message.status === "streaming"}>
          {#if message.content}
            <Markdown source={message.content} streaming={message.status === "streaming"} />
          {:else if message.status === "streaming"}
            <span class="drop drop--pulse" aria-label="Thinking"></span>
          {/if}
          {#if message.model && model && message.model !== model.id && message.status !== "error"}
            <p class="caption faint" data-tip="Not this chat's model: it was picked earlier, or the chat's model was busy and a fallback answered">Answered by {message.model}</p>
          {/if}
          {#if message.status === "error"}
            <div class="banner banner--danger"><Icon name="warning" /><span>{message.error}</span><span class="spacer"></span>
              <button type="button" class="btn btn--ghost btn--sm" onclick={() => retry(i)}>Try again</button></div>
          {:else if message.status === "aborted"}
            <p class="caption faint">{message.error ?? "Stopped."} <button type="button" class="link" onclick={() => retry(i)}>Ask again</button></p>
          {/if}
        </article>
      {/if}
    {/each}
  </div>
</div>

<div class="composer-wrap">
  {#if capWarn}
    <div class="banner banner--warning cap-warn"><Icon name="warning" />
      <span>{capWarn.checks.map((c) => `${periodLabel(c)}: ${Math.round((c.used / c.cap) * 100)} % of cap`).join(" · ")}</span>
      <span class="spacer"></span><a class="btn btn--ghost btn--sm" href="#/settings/limits">Limits</a></div>
  {/if}
  <Composer bind:value={draft} busy={controller !== null} onsend={send} onstop={() => controller?.abort()}>
    <ModelSelect value={model} onchange={pickModel} label="Model for this chat" compact />
  </Composer>
</div>

<Dialog bind:open={capHit.open} title="Token cap reached" eyebrow="Limit" danger>
  <p class="body-sm muted">Distil stopped before sending, so nothing was spent. Raise the cap or wait for it to reset.</p>
  {#each capHit.status?.checks.filter((c) => c.used >= c.cap) ?? [] as c (c.period + c.scope)}
    <p class="body-sm"><strong>{periodLabel(c)}</strong> <span class="mono muted">{fmt.format(c.used)} / {fmt.format(c.cap)}</span></p>
  {/each}
  {#snippet footer()}
    <button type="button" class="btn btn--ghost" onclick={() => (capHit.open = false)}>Wait for reset</button>
    <a class="btn btn--primary" href="#/settings/limits" onclick={() => (capHit.open = false)}>Raise cap</a>
  {/snippet}
</Dialog>

<style>
  .thread { display: grid; gap: var(--s-5); padding-bottom: var(--s-8); }
  .empty { display: grid; gap: var(--s-3); padding-top: 12vh; max-width: 56ch; }
  .turn--user { justify-self: end; max-width: min(70%, 640px); padding: var(--s-3) var(--s-4); background: var(--surface-sunken); border-radius: var(--r-md); }
  .turn--user p { white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--t-body); line-height: 25px; }
  .turn--assistant { display: grid; gap: var(--s-3); max-width: 72ch; }
  .turn--assistant + .turn--user { margin-top: var(--s-3); }
  /* Provider errors carry long URLs. */
  .turn--assistant { min-width: 0; }
  .turn--assistant .banner span { min-width: 0; overflow-wrap: anywhere; }
  .title-btn { min-width: 0; padding: 2px 6px; margin-left: -6px; border-radius: var(--r-xs); display: inline-flex; }
  .title-btn:hover { background: var(--surface-sunken); }
  .title-input { height: 30px; width: min(420px, 50vw); }
  .cap-warn { width: min(var(--content-max), 100%); margin: 0 auto var(--s-2); }
  .lesson-bar { border-bottom: 1px solid var(--border); padding: var(--s-2) var(--s-5); }
  .lesson-bar__inner { width: min(var(--content-max), 100%); margin: 0 auto; display: flex; align-items: center; gap: var(--s-2) var(--s-5); flex-wrap: wrap; }
  .lesson-bar__where { display: grid; min-width: 0; flex: 1 1 200px; }
  .lesson-bar__unit { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lesson-bar__progress { display: grid; gap: 4px; }
  .lesson-bar__items { display: flex; flex-wrap: wrap; gap: 3px; }
  .lesson-bar__items i { width: 14px; height: 6px; border-radius: 3px; border: 1px solid var(--border-control); }
  .lesson-bar__items .is-taught { background: color-mix(in oklab, var(--accent) 45%, transparent); border-color: var(--accent); }
  .lesson-bar__items .is-checked { background: var(--accent); border-color: var(--accent); }
  .lesson-bar__actions { display: flex; align-items: center; gap: var(--s-2); }
  .link { color: var(--text-muted); text-decoration: underline; text-underline-offset: 3px; }
  .link:hover { color: var(--text); }
</style>
