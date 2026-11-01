import { send, sseData } from "./http.ts";
import type { Adapter, Endpoint, Usage } from "./types.ts";

const headers = (endpoint: Endpoint) => ({
  "content-type": "application/json",
  ...(endpoint.apiKey && { "x-goog-api-key": endpoint.apiKey }),
});

type GeminiModel = { name: string; displayName?: string; inputTokenLimit?: number; supportedGenerationMethods?: string[] };

export const gemini: Adapter = {
  async *stream(endpoint, req) {
    const videos = req.messages.some((m) => m.videos?.length);
    const res = await send(endpoint, `/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: headers(endpoint),
      signal: req.signal,
      body: JSON.stringify({
        contents: req.messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [
            ...(m.videos ?? []).map((uri) => ({ file_data: { file_uri: uri } })),
            ...(m.images ?? []).map((i) => ({ inline_data: { mime_type: i.mime, data: i.data } })),
            { text: m.content },
          ],
        })),
        ...(req.system && { systemInstruction: { parts: [{ text: req.system }] } }),
        // Low media resolution: ~100 tokens per second of video instead of ~300; slides and boards stay legible.
        ...((req.maxTokens || videos) && { generationConfig: { ...(req.maxTokens && { maxOutputTokens: req.maxTokens }), ...(videos && { mediaResolution: "MEDIA_RESOLUTION_LOW" }) } }),
      }),
    });
    // usageMetadata is cumulative; the last chunk's value is the total.
    let usage: Usage | null = null;
    for await (const data of sseData(res)) {
      const chunk = JSON.parse(data);
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        if (part.text && !part.thought) yield { type: "text", text: part.text };
      }
      const u = chunk.usageMetadata;
      if (u) {
        usage = {
          input: u.promptTokenCount ?? 0,
          output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
          cached: u.cachedContentTokenCount ?? 0,
          reasoning: u.thoughtsTokenCount ?? 0,
        };
      }
    }
    if (usage) yield { type: "usage", usage };
  },

  async listModels(endpoint, signal) {
    return (await listAll(endpoint, signal)).filter((m) => m.methods.includes("generateContent")).map(({ methods: _, ...m }) => m);
  },

  async embed(endpoint, req) {
    const model = `models/${req.model}`;
    const res = await send(endpoint, `/${model}:batchEmbedContents`, {
      method: "POST",
      headers: headers(endpoint),
      signal: req.signal,
      body: JSON.stringify({ requests: req.texts.map((text) => ({
        model, content: { parts: [{ text }] }, taskType: req.task === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
      })) }),
    });
    const { embeddings = [] } = (await res.json()) as { embeddings?: { values: number[] }[] };
    return { vectors: embeddings.map((e) => e.values), tokens: null };
  },

  async listEmbeddingModels(endpoint, signal) {
    return (await listAll(endpoint, signal)).filter((m) => m.methods.includes("embedContent")).map(({ methods: _, ...m }) => m);
  },
};

async function listAll(endpoint: Endpoint, signal?: AbortSignal) {
  const res = await send(endpoint, "/models?pageSize=1000", { headers: headers(endpoint), signal });
  const { models = [] } = (await res.json()) as { models?: GeminiModel[] };
  return models.map((m) => ({
    id: m.name.replace(/^models\//, ""), name: m.displayName ?? m.name, contextWindow: m.inputTokenLimit ?? null,
    methods: m.supportedGenerationMethods ?? [],
  }));
}
