import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createServer } from "../server/main.ts";

const HOST = "localhost:5173";
const app = () => createServer({ port: 5173, dataDir: mkdtempSync(join(tmpdir(), "distil-test-")) }).app;
const req = (method: string, path: string, init: { body?: unknown; headers?: Record<string, string> } = {}) =>
  new Request(`http://${HOST}/api${path}`, {
    method,
    headers: { host: HOST, ...(init.body !== undefined && { "content-type": "application/json" }), ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

describe("API guard", () => {
  it("refuses unknown hosts (DNS rebinding)", async () => {
    const res = await app().fetch(req("GET", "/library", { headers: { host: "evil.test:5173" } }));
    expect(res.status).toBe(403);
  });

  it("refuses cross-origin requests", async () => {
    const res = await app().fetch(req("POST", "/folders", { body: { name: "x", parentId: null }, headers: { origin: "https://evil.test" } }));
    expect(res.status).toBe(403);
  });

  it("refuses non-JSON writes, which a plain HTML form could send", async () => {
    const res = await app().fetch(new Request(`http://${HOST}/api/folders`, {
      method: "POST", headers: { host: HOST, "content-type": "text/plain" }, body: "{}",
    }));
    expect(res.status).toBe(415);
  });
});

describe("API", () => {
  it("creates folders and chats and lists them", async () => {
    const a = app();
    const folder = await (await a.fetch(req("POST", "/folders", { body: { name: "Semester 5", parentId: null }, headers: { origin: `http://${HOST}` } }))).json();
    expect((await a.fetch(req("POST", "/chats", { body: { folderId: folder.id } }))).status).toBe(201);
    const library = await (await a.fetch(req("GET", "/library"))).json();
    expect(library.folders).toHaveLength(1);
    expect(library.chats[0]).toMatchObject({ folderId: folder.id, title: "New chat" });
  });

  it("returns readable validation errors", async () => {
    const res = await app().fetch(req("POST", "/folders", { body: { name: 42 } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_request" });
  });

  it("never returns API keys in full", async () => {
    const res = await app().fetch(req("GET", "/providers"));
    const list = await res.json();
    expect(list.find((p: { id: string }) => p.id === "google")).toMatchObject({ configured: false, keys: [] });
  });

  it("explains a turn without a model as a 400 before streaming", async () => {
    const a = app();
    const chat = await (await a.fetch(req("POST", "/chats", { body: { folderId: null } }))).json();
    const res = await a.fetch(req("POST", `/chats/${chat.id}/messages`, { body: { text: "Hi" } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "no_model" });
  });
});
