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
  const endpoint = (s: ProviderSpec, apiKey = secrets.get(s.id)): Endpoint => ({ baseUrl: s.baseUrl, apiKey, fetch: fetchImpl });
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
    list: () => specs().map((s) => {
      const key = secrets.get(s.id);
      return { ...s, configured: isConfigured(s), keyPreview: key ? maskKey(key) : null };
    }),

    models,

    // Checks a key by listing models with it, and saves it only if the provider accepts it.
    async setKey(id: string, key: string) {
      const s = spec(id);
      const trimmed = key.trim();
      if (!trimmed) throw new AppError(400, "invalid_key", "Paste a key first.");
      const list = await ADAPTERS[s.kind].listModels(endpoint(s, trimmed));
      secrets.set(id, trimmed);
      cache.set(id, { at: Date.now(), models: list });
      return { models: list.length };
    },

    removeKey(id: string) {
      spec(id);
      secrets.remove(id);
      cache.delete(id);
    },

    contextWindow: (ref: ModelRef) => cache.get(ref.provider)?.models.find((m) => m.id === ref.id)?.contextWindow ?? null,

    stream(ref: ModelRef, request: Omit<ChatRequest, "model">): AsyncIterable<StreamEvent> {
      const s = spec(ref.provider);
      if (!isConfigured(s)) throw new AppError(400, "not_configured", `Add a key for ${s.name} first.`);
      return ADAPTERS[s.kind].stream(endpoint(s), { ...request, model: ref.id });
    },
  };
}

export type Providers = ReturnType<typeof createProviders>;
