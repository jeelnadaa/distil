import { describe, expect, it } from "vitest";
import { anthropic } from "../server/providers/anthropic.ts";
import { gemini } from "../server/providers/gemini.ts";
import { openai } from "../server/providers/openai.ts";
import { collect, fakeFetch, sseResponse } from "./helpers.ts";

const request = { model: "m", system: "Be brief.", messages: [{ role: "user" as const, content: "Hi" }] };

describe("OpenAI-compatible adapter", () => {
  it("streams text, reports usage and sends the system prompt first", async () => {
    const { fetch, calls } = fakeFetch(() => sseResponse([
      { choices: [{ delta: { content: "Hel" } }] },
      { choices: [{ delta: { content: "lo" } }] },
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 4 } } },
      "[DONE]",
    ]));
    const events = await collect(openai.stream({ baseUrl: "https://x.test/v1/", apiKey: "k", fetch }, request));
    expect(events).toEqual([
      { type: "text", text: "Hel" },
      { type: "text", text: "lo" },
      { type: "usage", usage: { input: 12, output: 3, cached: 4, reasoning: 0 } },
    ]);
    expect(calls[0]!.url).toBe("https://x.test/v1/chat/completions");
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.messages[0]).toEqual({ role: "system", content: "Be brief." });
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer k");
  });

  it("turns a rejected key into a readable error", async () => {
    const { fetch } = fakeFetch(() => new Response(JSON.stringify({ error: { message: "Incorrect API key" } }), { status: 401 }));
    await expect(openai.listModels({ baseUrl: "https://x.test", apiKey: "bad", fetch })).rejects.toThrow(/rejected the key.*Incorrect API key/);
  });
});

describe("Anthropic adapter", () => {
  it("combines input usage from message_start with output usage from message_delta", async () => {
    const { fetch, calls } = fakeFetch(() => sseResponse([
      { type: "message_start", message: { usage: { input_tokens: 5, cache_read_input_tokens: 20, output_tokens: 1 } } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "Hi there" } },
      { type: "message_delta", usage: { output_tokens: 9 } },
      { type: "message_stop" },
    ]));
    const events = await collect(anthropic.stream({ baseUrl: "https://a.test/v1", apiKey: "k", fetch }, request));
    expect(events).toEqual([
      { type: "text", text: "Hi there" },
      { type: "usage", usage: { input: 25, output: 9, cached: 20, reasoning: 0 } },
    ]);
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toMatchObject({ system: "Be brief.", max_tokens: 8192, stream: true });
  });
});

describe("Gemini adapter", () => {
  it("skips thought parts, maps roles and counts thinking as output", async () => {
    const { fetch, calls } = fakeFetch(() => sseResponse([
      { candidates: [{ content: { parts: [{ text: "thinking…", thought: true }] } }] },
      { candidates: [{ content: { parts: [{ text: "Answer" }] } }], usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 2, thoughtsTokenCount: 30 } },
    ]));
    const events = await collect(gemini.stream({ baseUrl: "https://g.test/v1beta", apiKey: "k", fetch }, {
      ...request, messages: [...request.messages, { role: "assistant", content: "Yo" }, { role: "user", content: "More" }],
    }));
    expect(events).toEqual([
      { type: "text", text: "Answer" },
      { type: "usage", usage: { input: 8, output: 32, cached: 0, reasoning: 30 } },
    ]);
    expect(calls[0]!.url).toBe("https://g.test/v1beta/models/m:streamGenerateContent?alt=sse");
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(["user", "model", "user"]);
  });

  it("lists only models that can generate content", async () => {
    const { fetch } = fakeFetch(() => Response.json({ models: [
      { name: "models/gemini-x", displayName: "Gemini X", inputTokenLimit: 1048576, supportedGenerationMethods: ["generateContent"] },
      { name: "models/embed", supportedGenerationMethods: ["embedContent"] },
    ] }));
    expect(await gemini.listModels({ baseUrl: "https://g.test", apiKey: "k", fetch })).toEqual([
      { id: "gemini-x", name: "Gemini X", contextWindow: 1048576 },
    ]);
  });
});

describe("images in a request", () => {
  const withImage = { model: "m", messages: [{ role: "user" as const, content: "What is on page 3?", images: [{ mime: "image/png", data: "QUJD" }] }] };
  const bodyOf = async (adapter: typeof openai, events: unknown[]) => {
    const { fetch, calls } = fakeFetch(() => sseResponse(events));
    await collect(adapter.stream({ baseUrl: "https://x.test", apiKey: "k", fetch }, withImage));
    return JSON.parse(calls[0]!.init.body as string).messages ?? JSON.parse(calls[0]!.init.body as string).contents;
  };

  it("is encoded the way each provider expects, image before text", async () => {
    expect((await bodyOf(openai, ["[DONE]"]))[0].content).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } }, { type: "text", text: "What is on page 3?" },
    ]);
    expect((await bodyOf(anthropic, [{ type: "message_stop" }]))[0].content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } }, { type: "text", text: "What is on page 3?" },
    ]);
    expect((await bodyOf(gemini, []))[0].parts).toEqual([
      { inline_data: { mime_type: "image/png", data: "QUJD" } }, { text: "What is on page 3?" },
    ]);
  });

  it("leaves text-only messages unchanged", async () => {
    const { fetch, calls } = fakeFetch(() => sseResponse([{ type: "message_stop" }]));
    await collect(anthropic.stream({ baseUrl: "https://x.test", apiKey: "k", fetch }, request));
    expect(JSON.parse(calls[0]!.init.body as string).messages).toEqual([{ role: "user", content: "Hi" }]);
  });
});
