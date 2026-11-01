import { AppError } from "../errors.ts";

// Web search for the researcher (F-1209), with the learner's own key for Tavily or Brave Search. Only the
// query is sent, and only to the provider the key belongs to.

export const SEARCH_PROVIDERS = ["tavily", "brave"] as const;
export type SearchProvider = (typeof SEARCH_PROVIDERS)[number];
export type SearchResult = { title: string; url: string; snippet: string };
export const SEARCH_LABEL: Record<SearchProvider, string> = { tavily: "Tavily", brave: "Brave Search" };
// Where the secrets store keeps each provider's key.
export const searchSecret = (p: SearchProvider) => `search-${p}`;

const clip = (s: unknown, max: number) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, max);

export async function webSearch(provider: SearchProvider, key: string, query: string, o: { count?: number; signal?: AbortSignal; fetch?: typeof fetch } = {}): Promise<SearchResult[]> {
  const get = o.fetch ?? fetch;
  const count = o.count ?? 5;
  const res = provider === "tavily"
    ? await get("https://api.tavily.com/search", {
      method: "POST", signal: o.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, max_results: count, search_depth: "basic" }),
    })
    : await get(`https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q: query, count: String(count) })}`, {
      signal: o.signal, headers: { accept: "application/json", "x-subscription-token": key },
    });
  if (!res.ok) {
    const why = res.status === 401 || res.status === 403 ? "the key was refused" : res.status === 429 ? "the search quota is used up" : `it answered ${res.status}`;
    throw new AppError(502, "search_failed", `${SEARCH_LABEL[provider]} couldn't search: ${why}.`);
  }
  const data = await res.json() as { results?: { title?: string; url?: string; content?: string }[]; web?: { results?: { title?: string; url?: string; description?: string }[] } };
  const raw = provider === "tavily"
    ? (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content }))
    : (data.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description }));
  return raw.filter((r) => typeof r.url === "string" && /^https?:\/\//.test(r.url))
    .map((r) => ({ title: clip(r.title, 200), url: r.url!, snippet: clip(r.snippet, 1200) })).slice(0, count);
}
