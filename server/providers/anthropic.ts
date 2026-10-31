import { send, sseData } from "./http.ts";
import type { Adapter, Endpoint, Usage } from "./types.ts";

const DEFAULT_MAX_TOKENS = 8192;

const headers = (endpoint: Endpoint) => ({
  "content-type": "application/json",
  "anthropic-version": "2023-06-01",
  ...(endpoint.apiKey && { "x-api-key": endpoint.apiKey }),
});

export const anthropic: Adapter = {
  async *stream(endpoint, req) {
    const res = await send(endpoint, "/messages", {
      method: "POST",
      headers: headers(endpoint),
      signal: req.signal,
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        stream: true,
        ...(req.system && { system: req.system }),
        messages: req.messages,
      }),
    });
    // Input tokens arrive in message_start, output tokens in message_delta.
    const usage: Usage = { input: 0, output: 0, cached: 0, reasoning: 0 };
    for await (const data of sseData(res)) {
      const event = JSON.parse(data);
      if (event.type === "message_start") {
        const u = event.message?.usage ?? {};
        usage.cached = u.cache_read_input_tokens ?? 0;
        usage.input = (u.input_tokens ?? 0) + usage.cached + (u.cache_creation_input_tokens ?? 0);
        usage.output = u.output_tokens ?? 0;
      } else if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        yield { type: "text", text: event.delta.text };
      } else if (event.type === "message_delta" && event.usage) {
        usage.output = event.usage.output_tokens ?? usage.output;
      } else if (event.type === "message_stop") {
        yield { type: "usage", usage };
      } else if (event.type === "error") {
        throw new Error(event.error?.message ?? "The provider ended the stream with an error.");
      }
    }
  },

  async listModels(endpoint, signal) {
    const res = await send(endpoint, "/models?limit=1000", { headers: headers(endpoint), signal });
    const { data = [] } = (await res.json()) as { data?: { id: string; display_name?: string }[] };
    return data.map((m) => ({ id: m.id, name: m.display_name ?? m.id, contextWindow: null }));
  },
};
