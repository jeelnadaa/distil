import { ProviderError, type Endpoint } from "./types.ts";

// Sends a request and turns any non-2xx answer into a ProviderError carrying the provider's own message.
export async function send(endpoint: Endpoint, path: string, init: RequestInit): Promise<Response> {
  const res = await (endpoint.fetch ?? fetch)(endpoint.baseUrl.replace(/\/+$/, "") + path, init);
  if (res.ok) return res;
  const body = await res.text().catch(() => "");
  throw new ProviderError(res.status, describe(res.status, body));
}

function describe(status: number, body: string) {
  let detail = body.slice(0, 300);
  try {
    const json = JSON.parse(body);
    detail = json?.error?.message ?? json?.message ?? json?.error ?? detail;
  } catch { /* not JSON: keep the raw text */ }
  if (status === 401 || status === 403) return `The provider rejected the key (${status}). ${detail}`.trim();
  if (status === 429) return `The provider is rate-limiting or out of quota (429). ${detail}`.trim();
  return `Provider error ${status}. ${detail}`.trim();
}

// Yields the payload of each server-sent event's data lines.
export async function* sseData(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line === "") {
        if (data.length) yield data.join("\n");
        data = [];
      } else if (line.startsWith("data:")) {
        data.push(line.slice(5).replace(/^ /, ""));
      }
    }
  }
  if (data.length) yield data.join("\n");
}
