import { z } from "zod";
import type { Db } from "./db.ts";

// key: which of the provider's saved keys to use; its default key when absent.
const ModelRef = z.object({ provider: z.string().min(1), id: z.string().min(1), key: z.string().min(1).optional() });
const Limit = z.number().int().positive().nullable();
export const LOCAL_SIZES = ["small", "medium", "high"] as const;
// Meaning-based search (F-1005): off, an embedding model from a provider key, or a local model.
const Embeddings = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("off") }),
  z.object({ mode: z.literal("provider"), provider: z.string().min(1), id: z.string().min(1), key: z.string().min(1).optional() }),
  z.object({ mode: z.literal("local"), size: z.enum(LOCAL_SIZES) }),
]);
const CapPair = z.object({ daily: Limit, monthly: Limit });

export const SettingsSchema = z.object({
  // Two slots cover every job (F-401): strong for teaching and chat, cheap for naming and small tasks.
  models: z.object({ strong: ModelRef.nullable(), cheap: ModelRef.nullable() }),
  // Each slot's fallback chain: tried in order when the model before it is rate-limited, out of quota or capped.
  fallbacks: z.object({ strong: z.array(ModelRef).max(8), cheap: z.array(ModelRef).max(8) }),
  // Token caps (F-1104): warn at `warnAt`, hard stop at 100 %.
  caps: z.object({
    warnAt: z.number().min(0.1).max(0.99),
    global: CapPair,
    perProvider: z.record(z.string(), CapPair),
  }),
  embeddings: Embeddings,
  customEndpoints: z.array(z.object({
    id: z.string().regex(/^custom-[a-z0-9-]+$/),
    name: z.string().trim().min(1).max(60),
    baseUrl: z.url({ protocol: /^https?$/ }),
  })),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type ModelRef = z.infer<typeof ModelRef>;
export type EmbeddingsSetting = z.infer<typeof Embeddings>;
export type LocalSize = (typeof LOCAL_SIZES)[number];

export const DEFAULT_SETTINGS: Settings = {
  models: { strong: null, cheap: null },
  fallbacks: { strong: [], cheap: [] },
  caps: { warnAt: 0.8, global: { daily: null, monthly: null }, perProvider: {} },
  embeddings: { mode: "off" },
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
