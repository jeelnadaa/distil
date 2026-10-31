import { send, sseData } from "./http.ts";
import type { Adapter, Endpoint } from "./types.ts";

// OpenAI Chat Completions, which OpenRouter, DeepSeek, Mistral, Groq, xAI, Ollama and most proxies also speak.
const headers = (endpoint: Endpoint) => ({
  "content-type": "application/json",
  ...(endpoint.apiKey && { authorization: `Bearer ${endpoint.apiKey}` }),
});

export const openai: Adapter = {
  async *stream(endpoint, req) {
    const messages = [...(req.system ? [{ role: "system", content: req.system }] : []), ...req.messages];
    const res = await send(endpoint, "/chat/completions", {
      method: "POST",
      headers: headers(endpoint),
      signal: req.signal,
      body: JSON.stringify({
        model: req.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        ...(req.maxTokens && { max_tokens: req.maxTokens }),
      }),
    });
    for await (const data of sseData(res)) {
      if (data === "[DONE]") break;
      const chunk = JSON.parse(data);
      const text = chunk.choices?.[0]?.delta?.content;
      if (text) yield { type: "text", text };
      if (chunk.usage) {
        yield {
          type: "usage",
          usage: {
            input: chunk.usage.prompt_tokens ?? 0,
            output: chunk.usage.completion_tokens ?? 0,
            cached: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
            reasoning: chunk.usage.completion_tokens_details?.reasoning_tokens ?? 0,
          },
        };
      }
    }
  },

  async listModels(endpoint, signal) {
    const res = await send(endpoint, "/models", { headers: headers(endpoint), signal });
    const { data = [] } = (await res.json()) as { data?: { id: string; name?: string; context_length?: number }[] };
    return data.map((m) => ({ id: m.id, name: m.name ?? m.id, contextWindow: m.context_length ?? null }));
  },
};
