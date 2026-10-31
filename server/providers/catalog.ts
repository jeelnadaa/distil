import { anthropic } from "./anthropic.ts";
import { gemini } from "./gemini.ts";
import { openai } from "./openai.ts";
import type { Adapter } from "./types.ts";

export const ADAPTERS = { openai, anthropic, gemini } satisfies Record<string, Adapter>;
export type AdapterKind = keyof typeof ADAPTERS;

export type ProviderSpec = {
  id: string;
  name: string;
  kind: AdapterKind;
  baseUrl: string;
  keyHint: string;
  keyUrl: string | null;
  keyRequired: boolean;
  custom: boolean;
};

// Built-in providers (F-1201). Custom OpenAI-compatible endpoints (F-1202) are added from settings.
export const BUILT_IN: ProviderSpec[] = [
  { id: "google", name: "Google AI Studio", kind: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", keyHint: "AIza…", keyUrl: "https://aistudio.google.com/apikey" },
  { id: "anthropic", name: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com/v1", keyHint: "sk-ant-…", keyUrl: "https://console.anthropic.com/settings/keys" },
  { id: "openai", name: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", keyHint: "sk-…", keyUrl: "https://platform.openai.com/api-keys" },
  { id: "openrouter", name: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", keyHint: "sk-or-…", keyUrl: "https://openrouter.ai/keys" },
  { id: "deepseek", name: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com/v1", keyHint: "sk-…", keyUrl: "https://platform.deepseek.com/api_keys" },
  { id: "mistral", name: "Mistral", kind: "openai", baseUrl: "https://api.mistral.ai/v1", keyHint: "…", keyUrl: "https://console.mistral.ai/api-keys" },
  { id: "groq", name: "Groq", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", keyHint: "gsk_…", keyUrl: "https://console.groq.com/keys" },
  { id: "xai", name: "xAI", kind: "openai", baseUrl: "https://api.x.ai/v1", keyHint: "xai-…", keyUrl: "https://console.x.ai" },
].map((p) => ({ ...p, kind: p.kind as AdapterKind, keyRequired: true, custom: false }));

export type CustomEndpoint = { id: string; name: string; baseUrl: string };

export const customSpec = (c: CustomEndpoint): ProviderSpec => ({
  ...c, kind: "openai", keyHint: "Optional", keyUrl: null, keyRequired: false, custom: true,
});
