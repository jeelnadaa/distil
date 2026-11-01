import { describe, expect, it } from "vitest";
import { prepareTurn, streamTurn } from "../server/chat.ts";
import { openDb } from "../server/db.ts";
import { createLibrary } from "../server/library.ts";
import { createMessages } from "../server/messages.ts";
import type { Providers } from "../server/providers/service.ts";
import { createSettings } from "../server/settings.ts";
import { createUsage } from "../server/usage.ts";
import { fencedBlocks } from "../server/visuals/blocks.ts";
import { createVisuals } from "../server/visuals/builder.ts";
import { kitDocument } from "../server/visuals/kit.ts";
import { asksForVisual, widgetPromptReference } from "../server/visuals/reference.ts";
import { repairVisuals } from "../server/visuals/repair.ts";

type Request = { system: string; messages: { content: string }[] };

// A fake model that answers each system prompt with the next scripted reply for it, and records every request.
function setup(replies: Record<string, string[]> = {}) {
  const db = openDb(":memory:");
  const settings = createSettings(db);
  settings.update({ models: { strong: { provider: "google", id: "strong" }, cheap: { provider: "google", id: "cheap" } } });
  const library = createLibrary(db);
  const messages = createMessages(db);
  const usage = createUsage(db);
  const requests: Request[] = [];
  const providers = {
    async *stream(_ref: unknown, req: Request) {
      requests.push(req);
      const key = Object.keys(replies).find((k) => req.system.startsWith(k)) ?? "";
      const text = replies[key]?.shift() ?? "";
      yield { type: "text" as const, text };
      yield { type: "usage" as const, usage: { input: 10, output: 10, cached: 0, reasoning: 0 } };
    },
    describe: () => "fake",
    withKeys: (chain: unknown[]) => chain,
    contextWindow: () => null,
  } as unknown as Providers;
  return { db, settings, library, messages, usage, providers, requests };
}

describe("fenced blocks", () => {
  it("finds closed and open blocks with their info", () => {
    const blocks = fencedBlocks("Text\n```flow\na -> b\n```\n```js run\nconsole.log(1)\n```\n~~~quiz\nq: open?");
    expect(blocks.map((b) => [b.lang, b.info, b.source, b.closed])).toEqual([
      ["flow", "", "a -> b", true],
      ["js", "run", "console.log(1)", true],
      ["quiz", "", "q: open?", false],
    ]);
  });
});

describe("interactivity dial", () => {
  it("resolves chat, then the nearest folder up the tree, then Settings", () => {
    const { library } = setup();
    const top = library.createFolder("Maths", null);
    const sub = library.createFolder("Calculus", top.id);
    const chat = library.createChat(sub.id);
    expect(library.dialFor(chat, "balanced")).toBe("balanced");
    library.updateFolder(top.id, { dial: "visual" });
    expect(library.dialFor(library.getChat(chat.id), "balanced")).toBe("visual");
    library.updateFolder(sub.id, { dial: "text" });
    expect(library.dialFor(library.getChat(chat.id), "balanced")).toBe("text");
    const own = library.updateChat(chat.id, { dial: "visual" });
    expect(library.dialFor(own, "balanced")).toBe("visual");
  });

  it("sends the reference only when visuals are allowed or asked for", () => {
    expect(widgetPromptReference("text", "what is a derivative?")).toBe("");
    expect(asksForVisual("can you draw a diagram of this")).toBe(true);
    expect(widgetPromptReference("text", "draw a diagram of the loop")).toContain("Text-only");
    expect(widgetPromptReference("visual")).toContain("```flow");
  });

  it("changes what an Ask turn sends to the model", async () => {
    const { library, messages, providers, settings, usage, requests } = setup({ "You are Distil": ["Fine.", "Fine."] });
    const deps = { library, messages, providers, settings, usage };
    const chat = library.createChat(null);
    for await (const _ of streamTurn(deps, prepareTurn(deps, chat.id, "What is a limit?"), new AbortController().signal)) { /* drain */ }
    expect(requests[0]!.system).toContain("## Visuals");
    library.updateChat(chat.id, { dial: "text" });
    for await (const _ of streamTurn(deps, prepareTurn(deps, chat.id, "And a derivative?"), new AbortController().signal)) { /* drain */ }
    expect(requests.at(-1)!.system).not.toContain("## Visuals");
  });
});

describe("repair", () => {
  it("repairs a broken block once and leaves valid ones alone", async () => {
    const { providers, settings, usage, requests } = setup({ "You fix one widget block": ["a[Start] -> b[End]"] });
    const text = "Intro\n```flow\na[Start] => b[End]\n```\nMiddle\n```chart\nQ1: 1\n```\nEnd";
    const out = await repairVisuals({ providers, settings, usage }, text, null);
    expect(out).toBe("Intro\n```flow\na[Start] -> b[End]\n```\nMiddle\n```chart\nQ1: 1\n```\nEnd");
    expect(requests).toHaveLength(1);
    expect(requests[0]!.messages[0]!.content).toContain("Parser error");
  });

  it("keeps the block when the repair is still invalid", async () => {
    const { providers, settings, usage } = setup({ "You fix one widget block": ["still => broken"] });
    const text = "```flow\na => b\n```";
    expect(await repairVisuals({ providers, settings, usage }, text, null)).toBe(text);
  });

  it("repairs before a chat reply is saved", async () => {
    const { library, messages, providers, settings, usage } = setup({
      "You are Distil": ["Look:\n```plot\nf(x) = x^^2\n```"],
      "You fix one widget block": ["f(x) = x^2"],
    });
    const deps = { library, messages, providers, settings, usage };
    const chat = library.createChat(null);
    let done = "";
    for await (const e of streamTurn(deps, prepareTurn(deps, chat.id, "Plot x squared"), new AbortController().signal)) if (e.type === "done") done = e.message.content;
    expect(done).toBe("Look:\n```plot\nf(x) = x^2\n```");
    expect(messages.list(chat.id).at(-1)!.content).toBe(done);
  });
});

describe("built visuals", () => {
  const reply = "Watch the wave.\n```app\ntitle: Waves\nA wave with a frequency slider.\n```\nAnd the setup:\n```figure\nA lens with two rays.\n```";

  function withReply(replies: Record<string, string[]>) {
    const s = setup(replies);
    const chat = s.library.createChat(null);
    const m = s.messages.add({ chatId: chat.id, role: "assistant", content: reply, status: "done" });
    const visuals = createVisuals({ providers: s.providers, settings: s.settings, usage: s.usage, db: s.db, library: s.library, messages: s.messages });
    return { ...s, visuals, messageId: m.id };
  }

  it("builds a mini-app, fixes what the lint finds, and keeps versions", async () => {
    const { visuals, messageId, requests } = withReply({
      "You build one small": ['<div class="row"><button class="btn" style="color: red">Go</button></div>', "<p>v2</p>"],
      "You fix a generated mini-app": ['<div class="row"><button class="btn accent">Go</button></div>'],
    });
    const v1 = await visuals.build(messageId, 0, false);
    expect(v1).toMatchObject({ kind: "app", version: 1, content: '<div class="row"><button class="btn accent">Go</button></div>' });
    expect(requests[0]!.messages[0]!.content).toContain("A wave with a frequency slider.");
    expect(requests[1]!.messages[0]!.content).toContain("hard-codes a colour");
    // Built once: asking again returns it without a call.
    expect((await visuals.build(messageId, 0, false)).id).toBe(v1.id);
    expect(requests).toHaveLength(2);
    const v2 = await visuals.build(messageId, 0, true);
    expect(v2.version).toBe(2);
    expect(visuals.list(messageId).map((v) => v.version)).toEqual([1, 2]);
  });

  it("fixes runtime errors the browser reports", async () => {
    const { visuals, messageId, requests } = withReply({
      "You build one small": ["<script>undefinedThing()</script>"],
      "You fix a generated mini-app": ["<script>console.log(1)</script>"],
    });
    const v = await visuals.build(messageId, 0, false);
    const fixed = await visuals.fix(v.id, ["undefinedThing is not defined (line 1)"]);
    expect(fixed.content).toBe("<script>console.log(1)</script>");
    expect(requests.at(-1)!.messages[0]!.content).toContain("undefinedThing is not defined");
  });

  it("draws a figure through the sanitiser, redrawing when it lost elements", async () => {
    const { visuals, messageId, requests } = withReply({
      "You draw one precise": [
        '<svg viewBox="0 0 100 50"><script>alert(1)</script><rect x="1" y="1" width="10" height="10" fill="#e33"/></svg>',
        '<svg viewBox="0 0 100 50"><rect x="1" y="1" width="10" height="10" class="accent"/><text x="20" y="20" class="label">Lens</text></svg>',
      ],
    });
    const v = await visuals.build(messageId, 1, false);
    expect(v.kind).toBe("figure");
    expect(requests[1]!.messages[0]!.content).toContain("<script>");
    expect(v.content).not.toContain("script");
    expect(v.content).toContain('class="label"');
  });

  it("refuses a block that isn't in the reply", async () => {
    const { visuals, messageId } = withReply({});
    await expect(visuals.build(messageId, 5, false)).rejects.toThrow("isn't in this reply");
  });
});

describe("kit", () => {
  it("locks the frame down and carries the theme", () => {
    const doc = kitDocument("<p>Hi</p>", ":root { --text: #111; }");
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain(":root { --text: #111; }");
    expect(doc).toContain("window.distil");
    expect(doc.indexOf("window.distil")).toBeLessThan(doc.indexOf("<p>Hi</p>"));
  });
});
