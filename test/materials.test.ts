import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../server/db.ts";
import { createJobs } from "../server/jobs.ts";
import { createServer } from "../server/main.ts";
import { makePdf } from "./fixtures.ts";

const tempDir = () => mkdtempSync(join(tmpdir(), "distil-mat-"));

describe("jobs", () => {
  it("runs queued jobs with a concurrency limit and records progress", async () => {
    const jobs = createJobs(openDb(":memory:"), { concurrency: 1 });
    const order: string[] = [];
    jobs.register("work", async (job, { progress }) => {
      order.push(`start ${job.label}`);
      progress(1, 2);
      await new Promise((r) => setTimeout(r, 5));
      progress(2, 2);
      order.push(`end ${job.label}`);
    });
    const a = jobs.enqueue("work", "a");
    jobs.enqueue("work", "b");
    await jobs.idle();
    expect(order).toEqual(["start a", "end a", "start b", "end b"]);
    expect(jobs.get(a.id)).toMatchObject({ status: "done", done: 2, total: 2 });
  });

  it("records failures and aborts", async () => {
    const jobs = createJobs(openDb(":memory:"));
    jobs.register("fail", async () => { throw new Error("boom"); });
    jobs.register("slow", (_job, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("stopped")))));
    const failed = jobs.enqueue("fail", "x");
    const slow = jobs.enqueue("slow", "y");
    await new Promise((r) => setTimeout(r, 5));
    jobs.abort(slow.id);
    await jobs.idle();
    expect(jobs.get(failed.id)).toMatchObject({ status: "error", error: "boom" });
    expect(jobs.get(slow.id).status).toBe("aborted");
  });

  it("queues jobs again after a restart", async () => {
    const db = openDb(":memory:");
    const first = createJobs(db);
    const job = first.enqueue("later", "resume me"); // no handler yet, so it stays queued
    db.prepare("UPDATE jobs SET status = 'running' WHERE id = ?").run(job.id); // as if Distil stopped mid-run
    const second = createJobs(db);
    let ran = false;
    second.register("later", async () => { ran = true; });
    await second.idle();
    expect(ran).toBe(true);
    expect(second.get(job.id).status).toBe("done");
  });
});

describe("materials API", () => {
  const HOST = "localhost:5173";
  const setup = () => {
    const server = createServer({ port: 5173, dataDir: tempDir() });
    const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
      const raw = body instanceof Uint8Array;
      const res = await server.app.fetch(new Request(`http://${HOST}/api${path}`, {
        method,
        headers: { host: HOST, ...(body !== undefined && { "content-type": raw ? "application/octet-stream" : "application/json" }), ...headers },
        body: body === undefined ? undefined : raw ? new Blob([body as Uint8Array<ArrayBuffer>]) : JSON.stringify(body),
      }));
      return { status: res.status, json: res.headers.get("content-type")?.includes("json") ? await res.json() : null, res };
    };
    return { ...server, call };
  };

  it("copies an uploaded PDF, parses it in the background and lists it for subfolders", async () => {
    const { call, jobs } = setup();
    const folder = (await call("POST", "/folders", { name: "Signals", parentId: null })).json;
    const unit = (await call("POST", "/folders", { name: "Unit 1", parentId: folder.id })).json;
    const pdf = makePdf([["Unit 1: Signals", "A signal is a function of time."], ["Sampling at fs avoids aliasing."]]);
    const added = await call("POST", `/folders/${folder.id}/materials`, pdf, { "x-file-name": encodeURIComponent("Unit 1 – notes.pdf") });
    expect(added.status).toBe(201);
    expect(added.json).toMatchObject({ name: "Unit 1 – notes.pdf", kind: "pdf", status: "queued" });

    await jobs.idle();
    const detail = (await call("GET", `/materials/${added.json.id}`)).json;
    expect(detail.material).toMatchObject({ status: "ready", unit: "page", length: 2, chunks: 1 });
    expect(detail.chunks[0]).toMatchObject({ from: 1, to: 2 });
    expect(detail.chunks[0].text).toContain("Sampling at fs avoids aliasing.");

    const inherited = (await call("GET", `/folders/${unit.id}/materials`)).json;
    expect(inherited).toEqual([expect.objectContaining({ id: added.json.id, inherited: true })]);
    const file = await call("GET", `/materials/${added.json.id}/file`);
    expect(file.res.headers.get("content-type")).toBe("application/pdf");

    const dup = await call("POST", `/folders/${folder.id}/materials`, pdf, { "x-file-name": "again.pdf" });
    expect(dup.status).toBe(409);
    expect((await call("GET", "/jobs")).json[0]).toMatchObject({ kind: "parse", status: "done" });
  });

  it("marks unreadable files and removes material files with their folder", async () => {
    const { call, jobs } = setup();
    const folder = (await call("POST", "/folders", { name: "X", parentId: null })).json;
    const bad = (await call("POST", `/folders/${folder.id}/materials`, new TextEncoder().encode("%PDF-1.4 broken"), { "x-file-name": "bad.pdf" })).json;
    await jobs.idle();
    expect((await call("GET", `/materials/${bad.id}`)).json.material).toMatchObject({ status: "error", error: expect.stringMatching(/couldn't be opened/) });
    expect((await call("DELETE", `/folders/${folder.id}`)).status).toBe(204);
    expect((await call("GET", `/materials/${bad.id}`)).status).toBe(404);
  });

  it("only accepts raw uploads on the upload route", async () => {
    const { call } = setup();
    const folder = (await call("POST", "/folders", { name: "X", parentId: null })).json;
    expect((await call("PATCH", `/folders/${folder.id}`, new Uint8Array([1]))).status).toBe(415);
  });

  it("estimates extraction, and manages ledger items by hand", async () => {
    const { call, jobs } = setup();
    const folder = (await call("POST", "/folders", { name: "Signals", parentId: null })).json;
    await call("POST", `/folders/${folder.id}/materials`, new TextEncoder().encode("# Sampling\n\nAliasing folds frequencies."), { "x-file-name": "notes.md" });
    await jobs.idle();
    const balanced = (await call("GET", `/folders/${folder.id}/estimate`)).json;
    expect(balanced).toMatchObject({ materials: 1, chunks: 1 });
    expect(balanced.cheap.input).toBeGreaterThan(0);
    expect((await call("GET", `/folders/${folder.id}/estimate?strategy=thorough`)).json.cheap.input).toBe(0);
    expect((await call("GET", `/folders/${folder.id}/estimate?strategy=wild`)).status).toBe(400);

    const added = await call("POST", `/folders/${folder.id}/items`, { type: "fact", title: " Exam is open book " });
    expect(added.status).toBe(201);
    expect(added.json).toMatchObject({ title: "Exam is open book", origin: "manual", status: "pending", mark: null, sources: [] });
    const marked = await call("PATCH", `/items/${added.json.id}`, { mark: "known" });
    expect(marked.json.mark).toBe("known");
    expect((await call("PATCH", `/items/${added.json.id}`, { type: "nonsense" })).status).toBe(400);
    expect((await call("POST", "/folders/missing/items", { type: "fact", title: "x" })).status).toBe(404);
    expect((await call("GET", `/folders/${folder.id}/items`)).json).toHaveLength(1);
    expect((await call("DELETE", `/items/${added.json.id}`)).status).toBe(204);
    expect((await call("GET", `/folders/${folder.id}/items`)).json).toEqual([]);
  });
});
