import { z } from "zod";
import type { Db } from "./db.ts";

const ModelRef = z.object({ provider: z.string().min(1), id: z.string().min(1) });
const Limit = z.number().int().positive().nullable();
const CapPair = z.object({ daily: Limit, monthly: Limit });

export const SettingsSchema = z.object({
  // Two slots cover every job (F-401): strong for teaching and chat, cheap for naming and small tasks.
  models: z.object({ strong: ModelRef.nullable(), cheap: ModelRef.nullable() }),
  // Token caps (F-1104): warn at `warnAt`, hard stop at 100 %.
  caps: z.object({
    warnAt: z.number().min(0.1).max(0.99),
    global: CapPair,
    perProvider: z.record(z.string(), CapPair),
  }),
  customEndpoints: z.array(z.object({
    id: z.string().regex(/^custom-[a-z0-9-]+$/),
    name: z.string().trim().min(1).max(60),
    baseUrl: z.url({ protocol: /^https?$/ }),
  })),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type ModelRef = z.infer<typeof ModelRef>;

export const DEFAULT_SETTINGS: Settings = {
  models: { strong: null, cheap: null },
  caps: { warnAt: 0.8, global: { daily: null, monthly: null }, perProvider: {} },
  customEndpoints: [],
};

export const SettingsPatch = SettingsSchema.partial();

export function createSettings(db: Db) {
  const read = (): Settings => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'settings'").get() as { value: string } | undefined;
    if (!row) return DEFAULT_SETTINGS;
    // Unknown or invalid stored sections fall back to defaults instead of breaking the app.
    const parsed = SettingsSchema.partial().safeParse(JSON.parse(row.value));
    return { ...DEFAULT_SETTINGS, ...(parsed.success ? parsed.data : {}) };
  };

  return {
    get: read,
    update(patch: z.infer<typeof SettingsPatch>): Settings {
      const next = SettingsSchema.parse({ ...read(), ...patch });
      db.prepare("INSERT INTO settings (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(JSON.stringify(next));
      return next;
    },
  };
}

export type SettingsStore = ReturnType<typeof createSettings>;
