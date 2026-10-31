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
  };
}

export type UsageStore = ReturnType<typeof createUsage>;
