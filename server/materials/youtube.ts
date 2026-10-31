import { AppError } from "../errors.ts";
import { complete, type LlmDeps, videoSlot } from "../llm.ts";
import { TRANSCRIBE_SYSTEM } from "../prompts.ts";
import type { FetchFn, Fetched } from "./web.ts";

// YouTube materials (F-204). YouTube offers no public caption download for other people's videos,
// so a video becomes a transcript one of two ways: a Gemini model watches it (Google's API takes
// YouTube links directly), or the learner pastes the transcript YouTube shows under the video.
// Either way it is kept as Markdown with [mm:ss] times, so ledger anchors point into the video.

const ID = /^[\w-]{11}$/;
const MAX_TRANSCRIPT_TOKENS = 65_536;
export const MAX_PASTED_CHARS = 2_000_000;

// The video id of a YouTube link (watch, youtu.be, shorts, live, embed), or null for any other link.
export function youtubeId(url: URL): string | null {
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null | undefined = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/]+)/)?.[1];
  }
  return id && ID.test(id) ? id : null;
}

export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

// The title from YouTube's public oEmbed endpoint; a private or removed video has none.
export async function videoTitle(id: string, fetchFn: FetchFn = fetch): Promise<string> {
  let res: Response;
  try {
    res = await fetchFn(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl(id))}`, { signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new AppError(502, "fetch_failed", "YouTube couldn't be reached. Check your connection.");
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) throw new AppError(422, "video_unavailable", "That video is private, removed or can't be embedded, so Distil can't use it.");
  if (!res.ok) throw new AppError(502, "fetch_failed", `YouTube answered with an error (${res.status}).`);
  const { title } = (await res.json()) as { title?: string };
  return (title ?? "").trim() || `YouTube video ${id}`;
}

const document = (title: string, id: string, how: string, body: string) =>
  `# ${title}\n\nSource: <${watchUrl(id)}>\n\n*${how}*\n\n${body.trim()}\n`;
const fileName = (title: string) => `${title.replace(/[\\/:*?"<>|\n\r\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 150)}.md`;

// A transcript pasted from YouTube's "Show transcript" panel: timestamps on their own lines are joined
// to the text after them, and the lines are grouped into paragraphs of about a minute.
export function pastedTranscript(title: string, id: string, text: string): Fetched {
  if (text.length > MAX_PASTED_CHARS) throw new AppError(413, "transcript_too_long", "That transcript is too long. Split the video into parts.");
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  const STAMP = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/;
  const paragraphs: string[] = [];
  let current: string[] = [];
  let startedAt = -Infinity;
  let pendingStamp: string | null = null;
  for (const line of lines) {
    const stamp = line.match(STAMP);
    if (stamp) {
      pendingStamp = line;
      const seconds = Number(stamp[1] ?? 0) * 3600 + Number(stamp[2]) * 60 + Number(stamp[3]);
      if (seconds - startedAt >= 60 && current.length) { paragraphs.push(current.join(" ")); current = []; }
      if (!current.length) startedAt = seconds;
      continue;
    }
    current.push(!current.length && pendingStamp ? `[${pendingStamp}] ${line}` : line);
    pendingStamp = null;
  }
  if (current.length) paragraphs.push(current.join(" "));
  if (!paragraphs.length) throw new AppError(400, "empty_transcript", "The transcript is empty.");
  return { name: fileName(title), bytes: new TextEncoder().encode(document(title, id, "Transcript pasted from YouTube.", paragraphs.join("\n\n"))) };
}

// A Gemini model watches the video and writes the transcript, with what is shown on screen.
export async function transcribeVideo(deps: LlmDeps, id: string, title: string, folderId: string): Promise<Fetched> {
  const slot = videoSlot(deps.settings);
  if (!slot) throw new AppError(400, "needs_gemini", "Only Gemini models can watch videos. Pick a Gemini model in Settings › Models, or paste the transcript.");
  const text = await complete(deps, {
    slot, role: "transcriber", folderId, system: TRANSCRIBE_SYSTEM, videos: [watchUrl(id)], maxTokens: MAX_TRANSCRIPT_TOKENS,
    prompt: `Transcribe this video: “${title}”.`,
  });
  if (!text.trim()) throw new AppError(502, "empty_transcript", "The model returned no transcript. Try again, or paste the transcript.");
  return { name: fileName(title), bytes: new TextEncoder().encode(document(title, id, "Transcribed by a Gemini model from the video.", text)) };
}
