import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFonts, MAX_FONT_BYTES, sniffFont } from "../server/fonts.ts";
import { createServer } from "../server/main.ts";
import { cleanFamily, fontStack } from "../web/src/lib/prefs.ts";

const woff2 = Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(60)]);
const b64 = (bytes: Buffer) => bytes.toString("base64");
const tempDir = () => mkdtempSync(join(tmpdir(), "distil-fonts-"));

describe("font store", () => {
  it("recognises fonts by signature, not name", () => {
    expect(sniffFont(woff2)?.format).toBe("woff2");
    expect(sniffFont(Buffer.from([0, 1, 0, 0, 9]))?.format).toBe("truetype");
    expect(sniffFont(Buffer.from("OTTO...."))?.format).toBe("opentype");
    expect(sniffFont(Buffer.from("<svg>"))).toBeNull();
  });

  it("saves installed and uploaded fonts under a name, renames and removes them", () => {
    const fonts = createFonts(tempDir(), () => 42);
    expect(fonts.list()).toEqual([]);
    const file = fonts.addFile("Atkinson-Hyperlegible_Regular.woff2", b64(woff2));
    expect(file).toMatchObject({ name: "Atkinson Hyperlegible Regular", kind: "file", format: "woff2", size: woff2.length, addedAt: 42 });
    const installed = fonts.addInstalled("Anthropic Sans Text", "Anthropic");
    expect(installed).toMatchObject({ name: "Anthropic", kind: "installed", family: "Anthropic Sans Text" });
    expect(fonts.read(file.id).type).toBe("font/woff2");
    expect(fonts.rename(file.id, "Atkinson").name).toBe("Atkinson");
    expect(fonts.list().map((f) => f.name)).toEqual(["Atkinson", "Anthropic"]);
    fonts.remove(file.id);
    expect(() => fonts.read(file.id)).toThrow();
    expect(fonts.list().map((f) => f.id)).toEqual([installed.id]);
  });

  it("moves the single font file from before saved fonts into the list", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "text-font"), woff2);
    writeFileSync(join(dir, "text-font.json"), JSON.stringify({ name: "Old Font", updatedAt: 7 }));
    const fonts = createFonts(dir);
    expect(fonts.list()).toEqual([expect.objectContaining({ name: "Old Font", kind: "file", addedAt: 7 })]);
    expect(fonts.read(fonts.list()[0]!.id).type).toBe("font/woff2");
  });

  it("rejects files that aren't fonts or are too large", () => {
    const fonts = createFonts(tempDir());
    expect(() => fonts.addFile("evil.woff2", b64(Buffer.from("<script>alert(1)</script>")))).toThrow(/isn't a/);
    expect(() => fonts.addFile("huge.woff2", b64(Buffer.concat([woff2, Buffer.alloc(MAX_FONT_BYTES)])))).toThrow(/8 MB/);
    expect(fonts.list()).toEqual([]);
  });
});

describe("font routes", () => {
  const HOST = "localhost:5173";
  const call = (app: ReturnType<typeof createServer>["app"], method: string, path: string, body?: unknown) =>
    app.fetch(new Request(`http://${HOST}/api${path}`, {
      method,
      headers: { host: HOST, ...(body !== undefined && { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));

  it("adds, serves with the right type and deletes", async () => {
    const { app } = createServer({ port: 5173, dataDir: tempDir() });
    const added = await (await call(app, "POST", "/fonts", { fileName: "Mine.woff2", data: b64(woff2), name: "Mine" })).json();
    expect(added).toMatchObject({ name: "Mine", kind: "file" });
    const res = await call(app, "GET", `/fonts/${added.id}/file`);
    expect(res.headers.get("content-type")).toBe("font/woff2");
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString()).toBe("wOF2");
    expect((await call(app, "POST", "/fonts", { family: "Inter" })).status).toBe(201);
    expect((await (await call(app, "GET", "/fonts")).json()).map((f: { name: string }) => f.name)).toEqual(["Mine", "Inter"]);
    expect((await call(app, "DELETE", `/fonts/${added.id}`)).status).toBe(204);
    expect((await call(app, "GET", `/fonts/${added.id}/file`)).status).toBe(404);
  });
});

describe("text font stack", () => {
  it("puts the chosen face first and keeps Satoshi as the fallback", () => {
    expect(fontStack({ kind: "satoshi" })).toMatch(/^"Satoshi"/);
    expect(fontStack({ kind: "anthropic" })).toMatch(/^"Anthropic Sans Text", "Anthropic Sans", "Anthropic Sans Display", "Satoshi"/);
    expect(fontStack({ kind: "saved", id: "abcdef12-0000", family: "Inter" })).toMatch(/^"Inter", "Satoshi"/);
    expect(fontStack({ kind: "saved", id: "abcdef12-0000" })).toMatch(/^"Distil Font abcdef12", "Satoshi"/);
  });

  it("strips characters that could break out of the CSS string", () => {
    expect(cleanFamily('Inter"; } body { display: none')).toBe("Inter body display none");
    expect(cleanFamily("  Noto   Sans  Devanagari ")).toBe("Noto Sans Devanagari");
  });
});
