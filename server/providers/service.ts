import { AppError, notFound } from "../errors.ts";
import type { Secrets } from "../secrets.ts";
import { maskKey } from "../secrets.ts";
import type { ModelRef, SettingsStore } from "../settings.ts";
import { ADAPTERS, BUILT_IN, customSpec, type ProviderSpec } from "./catalog.ts";
import type { ChatRequest, Endpoint, ModelInfo, StreamEvent } from "./types.ts";

const MODEL_CACHE_MS = 10 * 60_000;

export function createProviders(settings: SettingsStore, secrets: Secrets, fetchImpl?: typeof fetch) {
  const specs = (): ProviderSpec[] => [...BUILT_IN, ...settings.get().customEndpoints.map(customSpec)];
  const spec = (id: string) => specs().find((s) => s.id === id) ?? (() => { throw notFound("Provider"); })();
  const isConfigured = (s: ProviderSpec) => s.custom || secrets.has(s.id);
  const endpoint = (s: ProviderSpec, apiKey = secrets.get(s.id)?.key ?? null): Endpoint => ({ baseUrl: s.baseUrl, apiKey, fetch: fetchImpl });
  const cache = new Map<string, { at: number; models: ModelInfo[] }>();

  const models = async (id: string, refresh = false): Promise<ModelInfo[]> => {
    const s = spec(id);
    if (!isConfigured(s)) throw new AppError(400, "not_configured", `Add a key for ${s.name} first.`);
    const hit = cache.get(id);
    if (hit && !refresh && Date.now() - hit.at < MODEL_CACHE_MS) return hit.models;
    const list = (await ADAPTERS[s.kind].listModels(endpoint(s))).sort((a, b) => a.id.localeCompare(b.id));
    cache.set(id, { at: Date.now(), models: list });
    return list;
  };

  return {
    list: () => specs().map((s) => ({
      ...s, configured: isConfigured(s),
      keys: secrets.list(s.id).map((k) => ({ id: k.id, label: k.label, preview: maskKey(k.key) })),
    })),

    models,

    // Checks a key by listing models with it, and saves it only if the provider accepts it.
    async addKey(id: string, key: string, label?: string) {
      const s = spec(id);
      const trimmed = key.trim();
      if (!trimmed) throw new AppError(400, "invalid_key", "Paste a key first.");
      if (secrets.list(id).some((k) => k.key === trimmed)) throw new AppError(409, "duplicate_key", `That key is already saved for ${s.name}.`);
      const list = await ADAPTERS[s.kind].listModels(endpoint(s, trimmed));
      const saved = secrets.add(id, trimmed, label);
      cache.set(id, { at: Date.now(), models: list });
      return { models: list.length, key: { id: saved.id, label: saved.label, preview: maskKey(saved.key) } };
    },

    // One key, or every key of the provider when keyId is left out. Model choices that named a removed
    // key go back to the provider's default key, or are dropped once the provider has none.
    removeKey(id: string, keyId?: string) {
      spec(id);
      if (keyId && !secrets.list(id).some((k) => k.id === keyId)) throw notFound("Key");
      secrets.remove(id, keyId);
      const left = secrets.has(id) || spec(id).custom;
      const fix = (ref: ModelRef | null): ModelRef | null => {
        if (ref?.provider !== id) return ref;
        if (!left) return null;
        return !keyId || ref.key === keyId ? { provider: ref.provider, id: ref.id } : ref;
      };
      const { models, fallbacks } = settings.get();
      settings.update({
        models: { strong: fix(models.strong), cheap: fix(models.cheap) },
        fallbacks: {
          strong: fallbacks.strong.map(fix).filter((r): r is ModelRef => !!r),
          cheap: fallbacks.cheap.map(fix).filter((r): r is ModelRef => !!r),
        },
      });
      if (!secrets.has(id)) cache.delete(id);
    },

    // How a model choice is shown: its model id, plus the key's label when the provider has several keys.
    describe(ref: ModelRef) {
      const keys = secrets.list(ref.provider);
      return keys.length > 1 ? `${ref.id} (${secrets.get(ref.provider, ref.key)?.label})` : ref.id;
    },

    // A fallback chain with every key spelled out: each model on its own key (the default when none is
    // named), then on the provider's other keys, before the next model in the chain. No repeats.
    withKeys(chain: ModelRef[]): ModelRef[] {
      const out: ModelRef[] = [];
      const add = (ref: ModelRef) => { if (!out.some((o) => o.provider === ref.provider && o.id === ref.id && o.key === ref.key)) out.push(ref); };
      for (const ref of chain) {
        const keys = secrets.list(ref.provider);
        if (!keys.length) { add(ref); continue; }
        const own = secrets.get(ref.provider, ref.key)!;
        for (const k of [own, ...keys.filter((k) => k.id !== own.id)]) add({ provider: ref.provider, id: ref.id, key: k.id });
      }
      return out;
    },

    contextWindow: (ref: ModelRef) => cache.get(ref.provider)?.models.find((m) => m.id === ref.id)?.contextWindow ?? null,

    stream(ref: ModelRef, request: Omit<ChatRequest, "model">): AsyncIterable<StreamEvent> {
      const s = spec(ref.provider);
      if (!isConfigured(s)) throw new AppError(400, "not_configured", `Add a key for ${s.name} first.`);
      return ADAPTERS[s.kind].stream(endpoint(s, secrets.get(s.id, ref.key)?.key ?? null), { ...request, model: ref.id });
    },
  };
}

export type Providers = ReturnType<typeof createProviders>;
