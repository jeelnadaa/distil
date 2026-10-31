import type { Adapter, StreamEvent } from "../server/providers/types.ts";

// A Response whose body streams the given server-sent events, split across awkward chunk boundaries.
export function sseResponse(events: unknown[]): Response {
  const text = events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\r\n\r\n`).join("");
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });
}

export type Captured = { url: string; init: RequestInit };

export function fakeFetch(respond: (url: string, init: RequestInit) => Response) {
  const calls: Captured[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond(url, init);
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

export async function collect(stream: AsyncIterable<StreamEvent>) {
  const events: StreamEvent[] = [];
  for await (const e of stream) events.push(e);
  return events;
}

// A scripted model: each call to stream() plays the next reply.
export function scriptedAdapter(replies: (string | Error)[]): Adapter & { requests: unknown[] } {
  const requests: unknown[] = [];
  return {
    requests,
    async *stream(_endpoint, req) {
      requests.push(req);
      const reply = replies.shift() ?? "";
      if (reply instanceof Error) throw reply;
      for (const word of reply.split(/(?<= )/)) {
        if (req.signal?.aborted) throw new DOMException("aborted", "AbortError");
        yield { type: "text", text: word };
      }
      yield { type: "usage", usage: { input: 10, output: reply.length, cached: 0, reasoning: 0 } };
    },
    async listModels() {
      return [{ id: "test-model", name: "Test", contextWindow: 1000 }];
    },
  };
}
