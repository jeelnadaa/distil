<script lang="ts">
  import { api, type CapStatus, type UsagePeriod, type UsageReport, type UsageRow } from "../lib/api.ts";
  import { attempt, nav } from "../lib/state.svelte.ts";
  import ActivityDock from "./ActivityDock.svelte";
  import Icon from "./Icon.svelte";
  import Segmented from "./Segmented.svelte";

  // Usage (S8, F-1103, F-1108): tokens in and out per hour of today or per day of the last week or month,
  // what they went on, how close the caps are, and the requests as CSV. Tokens only: Distil doesn't know
  // each model's price, so it shows no money figures (F-1109).
  type Dimension = keyof UsageReport["by"];
  const DIMENSIONS: { value: Dimension; label: string }[] = [
    { value: "model", label: "Model" }, { value: "provider", label: "Provider" }, { value: "role", label: "Role" },
    { value: "folder", label: "Folder" }, { value: "chat", label: "Chat" },
  ];
  // What each role's requests are for.
  const ROLES: Record<string, string> = {
    chat: "Chat replies", teacher: "Teaching", namer: "Chat names", extractor: "Distilling", auditor: "Recall audits", merger: "Merging items",
    planner: "Plans", brief: "Briefs", visuals: "Visuals", practice: "Practice questions", grader: "Marking", cards: "Flashcards",
    graph: "Knowledge graph", embed: "Search index", transcriber: "Transcripts", researcher: "Topic research",
  };

  let period = $state<UsagePeriod>("week");
  let dimension = $state<Dimension>("model");
  let report = $state<UsageReport | null>(null);
  let caps = $state<CapStatus | null>(null);

  $effect(() => {
    const p = period;
    attempt(() => api.usageReport(p)).then((r) => { if (r && p === period) report = r; });
  });
  $effect(() => { attempt(api.usage).then((u) => { if (u) caps = u.cap; }); });

  const fmt = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
  const exact = new Intl.NumberFormat();
  const peak = $derived(Math.max(1, ...(report?.series.map((b) => b.input + b.output) ?? [1])));
  const tick = (start: number) => period === "day"
    ? new Date(start).toLocaleTimeString(undefined, { hour: "numeric" })
    : new Date(start).toLocaleDateString(undefined, period === "week" ? { weekday: "short" } : { day: "numeric", month: "short" });
  // Every bar in a week, every third hour, every fifth day of a month gets a label.
  const labelled = (i: number) => period === "week" || i % (period === "day" ? 3 : 5) === 0;
  const name = (row: UsageRow) => dimension === "role" ? ROLES[row.key ?? ""] ?? row.key ?? "Other"
    : row.label ?? row.key ?? (dimension === "chat" ? "Background work" : dimension === "folder" ? "No folder" : "Unknown");
  const rows = $derived(report?.by[dimension] ?? []);
  const share = (row: UsageRow) => (report && report.total.input + report.total.output ? (row.input + row.output) / (report.total.input + report.total.output) : 0);
  const PERIOD: Record<UsagePeriod, string> = { day: "today", week: "in the last 7 days", month: "in the last 30 days" };
</script>

<header class="topbar">
  <button type="button" class="btn btn--ghost btn--icon btn--sm topbar__menu" aria-label="Open menu" onclick={() => (nav.sidebarOpen = true)}><Icon name="sidebar" size="sm" /></button>
  <nav class="topbar__crumb" aria-label="Location"><strong>Usage</strong></nav>
  <span class="topbar__spacer"></span>
  <ActivityDock />
</header>

<div class="scroll">
  <div class="page page--wide usage">
    <header class="usage__head">
      <div>
        <p class="eyebrow">Tokens {PERIOD[period]}</p>
        <h1 class="display-lg">{report ? fmt.format(report.total.input + report.total.output) : "…"}</h1>
        {#if report}<p class="muted">{exact.format(report.total.input)} in · {exact.format(report.total.output)} out · {exact.format(report.requests)} {report.requests === 1 ? "request" : "requests"}</p>{/if}
      </div>
      <div class="usage__tools">
        <Segmented label="Period" value={period} onchange={(v) => (period = v)} options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
        <a class="btn btn--secondary btn--sm" href={api.usageExportUrl(period)} download><Icon name="download" size="sm" />Export CSV</a>
      </div>
    </header>

    {#if report}
      <section class="panel chart" aria-label="Tokens per {period === 'day' ? 'hour' : 'day'}">
        <div class="chart__legend caption">
          <span><i class="sw sw--in"></i>Input</span><span><i class="sw sw--out"></i>Output</span>
          <span class="faint">Peak {fmt.format(peak)}</span>
        </div>
        <div class="chart__bars" style:--n={report.series.length}>
          {#each report.series as b, i (b.start)}
            <div class="chart__col" data-tip="{tick(b.start)} · {exact.format(b.input)} in · {exact.format(b.output)} out">
              <div class="chart__stack">
                <span class="bar bar--out" style:height="{(b.output / peak) * 100}%"></span>
                <span class="bar bar--in" style:height="{(b.input / peak) * 100}%"></span>
              </div>
              <span class="chart__tick mono">{labelled(i) ? tick(b.start) : ""}</span>
            </div>
          {/each}
        </div>
      </section>

      <div class="usage__grid">
        <section class="usage__section">
          <header>
            <span class="eyebrow">By {DIMENSIONS.find((d) => d.value === dimension)!.label.toLowerCase()}</span>
            <Segmented label="Break down by" value={dimension} onchange={(v) => (dimension = v)} options={DIMENSIONS} />
          </header>
          {#if rows.length}
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>{DIMENSIONS.find((d) => d.value === dimension)!.label}</th><th class="num">In</th><th class="num">Out</th><th class="num">Requests</th><th class="num">Share</th></tr></thead>
                <tbody>
                  {#each rows as row (row.key ?? "none")}
                    <tr>
                      <td class="usage__name">{#if dimension === "chat" && row.key}<a href="#/chat/{row.key}">{name(row)}</a>{:else if dimension === "folder" && row.key}<a href="#/folder/{row.key}">{name(row)}</a>{:else}{name(row)}{/if}</td>
                      <td class="num mono">{fmt.format(row.input)}</td>
                      <td class="num mono">{fmt.format(row.output)}</td>
                      <td class="num mono">{exact.format(row.requests)}</td>
                      <td class="num"><span class="share"><i style:width="{share(row) * 100}%"></i></span><span class="mono caption">{Math.round(share(row) * 100)}%</span></td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else}
            <p class="body-sm muted">Nothing used {PERIOD[period]}.</p>
          {/if}
        </section>

        <section class="usage__section">
          <header><span class="eyebrow">Caps</span><a class="btn btn--ghost btn--sm" href="#/settings/limits">Edit caps</a></header>
          {#if caps?.checks.length}
            {#each caps.checks as c (c.scope + c.period)}
              {@const pct = Math.min(1, c.used / c.cap)}
              <div class="cap">
                <div class="cap__row"><strong class="body-sm">{c.scope} · {c.period === "daily" ? "today" : "this month"}</strong><span class="mono caption">{fmt.format(c.used)} / {fmt.format(c.cap)}</span></div>
                <div class="cap__bar" class:is-warn={caps.state !== "ok" && pct >= 0.7} class:is-full={pct >= 1}><i style:width="{pct * 100}%"></i></div>
              </div>
            {/each}
          {:else}
            <p class="body-sm muted">No caps set. Daily and monthly token caps, for all providers or one, are in Settings › Limits.</p>
          {/if}
        </section>
      </div>
    {/if}
  </div>
</div>

<style>
  .usage { display: grid; gap: var(--s-6); }
  .usage__head { display: flex; justify-content: space-between; align-items: end; gap: var(--s-4); flex-wrap: wrap; }
  .usage__tools { display: flex; gap: var(--s-3); align-items: center; flex-wrap: wrap; }
  .chart { padding: var(--s-5); display: grid; gap: var(--s-4); }
  .chart__legend { display: flex; gap: var(--s-4); align-items: center; color: var(--text-muted); }
  .chart__legend span { display: inline-flex; gap: 6px; align-items: center; }
  .chart__legend .faint { margin-left: auto; }
  .sw { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  .sw--in, .bar--in { background: var(--viz-4); }
  .sw--out, .bar--out { background: var(--viz-2); }
  .chart__bars { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 3px; height: 220px; }
  .chart__col { display: grid; grid-template-rows: minmax(0, 1fr) 18px; gap: 6px; min-width: 0; }
  .chart__col:hover .bar { filter: brightness(1.15); }
  .chart__stack { display: flex; flex-direction: column; justify-content: flex-end; border-bottom: 1px solid var(--border); }
  .bar { display: block; width: 100%; min-height: 0; }
  .bar--out { border-radius: 2px 2px 0 0; }
  .chart__tick { font-size: 10px; color: var(--text-faint); text-align: center; white-space: nowrap; overflow: visible; }
  .usage__grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: var(--s-6); align-items: start; }
  .usage__section { display: grid; gap: var(--s-3); min-width: 0; }
  .usage__section > header { display: flex; justify-content: space-between; align-items: center; gap: var(--s-3); flex-wrap: wrap; min-height: 32px; }
  .usage__name { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .usage__name a { color: inherit; }
  .share { display: inline-block; width: 48px; height: 4px; border-radius: 2px; background: var(--border); margin-right: 8px; vertical-align: middle; overflow: hidden; }
  .share i { display: block; height: 100%; background: var(--accent); }
  .cap { display: grid; gap: 6px; padding: var(--s-2) 0; }
  .cap__row { display: flex; justify-content: space-between; gap: var(--s-3); }
  .cap__bar { height: 6px; border-radius: 3px; background: var(--border); overflow: hidden; }
  .cap__bar i { display: block; height: 100%; background: var(--accent); }
  .cap__bar.is-warn i { background: var(--warning); }
  .cap__bar.is-full i { background: var(--danger); }
  @media (max-width: 900px) { .usage__grid { grid-template-columns: minmax(0, 1fr); } }
  @media (max-width: 640px) { .chart__bars { height: 160px; gap: 1px; } .chart__tick { font-size: 9px; } }
</style>
