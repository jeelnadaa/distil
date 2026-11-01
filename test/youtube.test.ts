import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../server/db.ts";
import { createServer } from "../server/main.ts";
import { pastedTranscript, transcribeVideo, youtubeId } from "../server/materials/youtube.ts";
import type { Providers } from "../server/providers/service.ts";
import type { ChatRequest } from "../server/providers/types.ts";
import { createSettings } from "../server/settings.ts";
import { createUsage } from "../server/usage.ts";

const ID = "aircAruvnKk";
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("YouTube links", () => {
  it("finds the video id in every kind of YouTube link", () => {
    for (const link of [`https://www.youtube.com/watch?v=${ID}&t=42s`, `https://youtu.be/${ID}?si=x`, `https://m.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/live/${ID}`, `https://www.youtube-nocookie.com/embed/${ID}`]) expect(youtubeId(new URL(link))).toBe(ID);
    expect(youtubeId(new URL("https://www.youtube.com/@3blue1brown"))).toBeNull();
    expect(youtubeId(new URL("https://example.com/watch?v=aircAruvnKk"))).toBeNull();
  });

  it("groups a pasted transcript into timed paragraphs of about a minute", () => {
    const pasted = "0:00\nWhat is a neural network?\n0:20\nIt is inspired by the brain.\n1:05\nEach neuron holds a number.\n1:30\nCalled its activation.";
    const md = text(pastedTranscript("Neural networks", ID, pasted).bytes);
    expect(md).toContain(`Source: <https://www.youtube.com/watch?v=${ID}>`);
    expect(md).toContain("[0:00] What is a neural network? It is inspired by the brain.\n\n[1:05] Each neuron holds a number. Called its activation.");
    expect(() => pastedTranscript("x", ID, "\n0:01\n")).toThrow(/empty/);
  });

  it("has a Gemini model watch the video, and refuses other providers", async () => {
    const db = openDb(":memory:");
    const settings = createSettings(db);
    settings.update({ models: { strong: { provider: "openai", id: "gpt" }, cheap: { provider: "google", id: "flash-lite" } } });
    const seen: { model: string; request: ChatRequest }[] = [];
    const providers = {
      async *stream(ref: { id: string }, request: ChatRequest) {
        seen.push({ model: ref.id, request });
        yield { type: "text" as const, text: "[00:00] Hello.\n\nOn screen: $a^2$" };
      },
      withKeys: (chain: unknown[]) => chain,
    } as unknown as Providers;
    const deps = { providers, settings, usage: createUsage(db) };
    const md = text((await transcribeVideo(deps, ID, "Intro", "f1")).bytes);
    expect(md).toContain("On screen: $a^2$");
    expect(seen[0]).toMatchObject({ model: "flash-lite" });
    expect(seen[0]!.request.messages[0]!.videos).toEqual([`https://www.youtube.com/watch?v=${ID}`]);

    settings.update({ models: { strong: { provider: "openai", id: "gpt" }, cheap: null } });
    await expect(transcribeVideo(deps, ID, "Intro", "f1")).rejects.toMatchObject({ code: "needs_gemini" });
  });

  it("adds a video with a pasted transcript as a material", async () => {
    const fetch = (async (input: URL | RequestInfo) => String(input).includes("oembed")
      ? Response.json({ title: "But what is a neural network?" })
      : new Response("unexpected", { status: 500 })) as typeof globalThis.fetch;
    const server = createServer({ port: 5173, dataDir: mkdtempSync(join(tmpdir(), "distil-yt-")), fetch });
    const call = async (path: string, body: unknown) => {
      const res = await server.app.fetch(new Request(`http://localhost:5173/api${path}`, {
        method: "POST", headers: { host: "localhost:5173", "content-type": "application/json" }, body: JSON.stringify(body),
      }));
      return { status: res.status, json: await res.json() };
    };
    const folder = (await call("/folders", { name: "ML", parentId: null })).json;
    const added = await call(`/folders/${folder.id}/materials/url`, { url: `https://youtu.be/${ID}`, transcript: "0:00\nNeurons hold numbers." });
    expect(added.status).toBe(201);
    expect(added.json).toMatchObject({ kind: "markdown", name: "But what is a neural network.md", source: `https://www.youtube.com/watch?v=${ID}` });
    // Without a transcript and with no Gemini model set up, it says what to do instead.
    expect((await call(`/folders/${folder.id}/materials/url`, { url: `https://youtu.be/${ID}` })).json).toMatchObject({ code: "needs_gemini" });
  });
});
