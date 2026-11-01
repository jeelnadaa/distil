import type { Db } from "./db.ts";
import type { Usage } from "./providers/types.ts";
import type { Settings } from "./settings.ts";

export type UsageEntry = {
  provider: string;
  model: string;
  role: string;
  chatId: string | null;
  folderId: string | null;
  usage: Usage;
  estimated: boolean;
};

export type CapCheck = { scope: string; period: "daily" | "monthly"; provider: string | null; used: number; cap: number };
export type CapStatus = { state: "ok" | "warn" | "blocked"; checks: CapCheck[] };

const startOfDay = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const startOfMonth = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };

// Rough tokens for providers that don't report usage (some local servers). Recorded as estimated.
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export function createUsage(db: Db, now = () => Date.now()) {
  const tokensSince = (since: number, provider: string | null) =>
    (db.prepare(`SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS total FROM usage
                 WHERE at >= ? AND (? IS NULL OR provider = ?)`).get(since, provider, provider) as { total: number }).total;

  return {
    record(e: UsageEntry) {
      db.prepare(`INSERT INTO usage (at, provider, model, role, chat_id, folder_id, input_tokens, output_tokens,
                                     cached_tokens, reasoning_tokens, estimated)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(now(), e.provider, e.model, e.role, e.chatId, e.folderId, e.usage.input, e.usage.output,
          e.usage.cached, e.usage.reasoning, e.estimated ? 1 : 0);
    },

    // Every cap that applies to a request on `provider`, with how much of it is used (F-1104, F-1105).
    capStatus(caps: Settings["caps"], provider: string): CapStatus {
      const t = now();
      const since = { daily: startOfDay(t), monthly: startOfMonth(t) };
      const checks: CapCheck[] = [];
      for (const period of ["daily", "monthly"] as const) {
        const global = caps.global[period];
        if (global) checks.push({ scope: "All providers", period, provider: null, used: tokensSince(since[period], null), cap: global });
        const own = caps.perProvider[provider]?.[period];
        if (own) checks.push({ scope: provider, period, provider, used: tokensSince(since[period], provider), cap: own });
      }
      const state = checks.some((c) => c.used >= c.cap) ? "blocked"
        : checks.some((c) => c.used >= c.cap * caps.warnAt) ? "warn" : "ok";
      return { state, checks };
    },

    // This chat's spend and the size of its latest prompt, for the in-chat meter (F-1102).
    chatMeter(chatId: string) {
      const totals = db.prepare(`SELECT COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(output_tokens), 0) AS output
                                 FROM usage WHERE chat_id = ?`).get(chatId) as { input: number; output: number };
      const last = db.prepare(`SELECT input_tokens + output_tokens AS context FROM usage
                               WHERE chat_id = ? AND role = 'chat' ORDER BY id DESC LIMIT 1`).get(chatId) as { context: number } | undefined;
      return { ...totals, context: last?.context ?? 0 };
    },

    totals() {
      const t = now();
      return { today: tokensSince(startOfDay(t), null), month: tokensSince(startOfMonth(t), null) };
    },

    // The usage dashboard (F-1103): input and output per hour of today, or per day of the last 7 or 30 days,
    // and the period's totals by model, provider, role, folder and chat.
    report(period: UsagePeriod): UsageReport {
      const t = now();
      const today = startOfDay(t);
      const buckets = period === "day"
        ? Array.from({ length: 24 }, (_, h) => new Date(today).setHours(h))
        : Array.from({ length: period === "week" ? 7 : 30 }, (_, i) => { const d = new Date(today); d.setDate(d.getDate() - (period === "week" ? 6 : 29) + i); return d.getTime(); });
      const since = buckets[0]!;
      const rows = db.prepare("SELECT at, input_tokens AS input, output_tokens AS output FROM usage WHERE at >= ?").all(since) as { at: number; input: number; output: number }[];
      const series = buckets.map((start) => ({ start, input: 0, output: 0 }));
      for (const r of rows) {
        let i = series.length - 1;
        while (i > 0 && series[i]!.start > r.at) i--;
        series[i]!.input += r.input;
        series[i]!.output += r.output;
      }
      const by = (column: string, label = column) => db.prepare(`SELECT ${label} AS label, ${column} AS key, SUM(u.input_tokens) AS input, SUM(u.output_tokens) AS output, COUNT(*) AS requests
        FROM usage u LEFT JOIN folders f ON f.id = u.folder_id LEFT JOIN chats c ON c.id = u.chat_id
        WHERE u.at >= ? GROUP BY ${column} ORDER BY SUM(u.input_tokens + u.output_tokens) DESC LIMIT 20`).all(since) as UsageRow[];
      const total = series.reduce((s, b) => ({ input: s.input + b.input, output: s.output + b.output }), { input: 0, output: 0 });
      return {
        period, since, series, total, requests: rows.length,
        by: { model: by("u.model"), provider: by("u.provider"), role: by("u.role"), folder: by("u.folder_id", "f.name"), chat: by("u.chat_id", "c.title") },
      };
    },

    // Every request since `since`, for the CSV export (F-1108).
    csv(since: number): string {
      const rows = db.prepare(`SELECT u.at, u.provider, u.model, u.role, f.name AS folder, c.title AS chat, u.input_tokens, u.output_tokens,
          u.cached_tokens, u.reasoning_tokens, u.estimated FROM usage u LEFT JOIN folders f ON f.id = u.folder_id LEFT JOIN chats c ON c.id = u.chat_id
          WHERE u.at >= ? ORDER BY u.at`).all(since) as Record<string, string | number | null>[];
      const cell = (v: string | number | null) => (v === null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
      const head = ["time", "provider", "model", "role", "folder", "chat", "input", "output", "cached", "reasoning", "estimated"];
      return [head.join(","), ...rows.map((r) => [new Date(r.at as number).toISOString(), ...Object.values(r).slice(1)].map(cell).join(","))].join("\n") + "\n";
    },
  };
}

export type UsagePeriod = "day" | "week" | "month";
// One group in a breakdown: `key` is the model, provider, role, folder id or chat id; `label` what to show
// (a folder or chat that was deleted since has no label).
export type UsageRow = { key: string | null; label: string | null; input: number; output: number; requests: number };
export type UsageReport = {
  period: UsagePeriod; since: number; total: { input: number; output: number }; requests: number;
  series: { start: number; input: number; output: number }[];
  by: Record<"model" | "provider" | "role" | "folder" | "chat", UsageRow[]>;
};

export type UsageStore = ReturnType<typeof createUsage>;
