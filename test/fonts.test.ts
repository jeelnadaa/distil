import { mkdtempSync } from "node:fs";
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

  it("saves, reads and removes the uploaded font", () => {
    const fonts = createFonts(tempDir(), () => 42);
    expect(fonts.info()).toBeNull();
    expect(fonts.save("Atkinson-Hyperlegible_Regular.woff2", b64(woff2))).toEqual({ name: "Atkinson Hyperlegible Regular", format: "woff2", size: woff2.length, updatedAt: 42 });
    expect(fonts.read()?.type).toBe("font/woff2");
    fonts.remove();
    expect(fonts.read()).toBeNull();
    expect(fonts.info()).toBeNull();
  });

  it("rejects files that aren't fonts or are too large", () => {
    const fonts = createFonts(tempDir());
    expect(() => fonts.save("evil.woff2", b64(Buffer.from("<script>alert(1)</script>")))).toThrow(/isn't a/);
    expect(() => fonts.save("huge.woff2", b64(Buffer.concat([woff2, Buffer.alloc(MAX_FONT_BYTES)])))).toThrow(/8 MB/);
  });
});

describe("font routes", () => {
  const HOST = "localhost:5173";
  const call = (app: ReturnType<typeof createServer>["app"], method: string, body?: unknown) =>
    app.fetch(new Request(`http://${HOST}/api/fonts/text`, {
      method,
      headers: { host: HOST, ...(body !== undefined && { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));

  it("uploads, serves with the right type and deletes", async () => {
    const { app } = createServer({ port: 5173, dataDir: tempDir() });
    expect((await call(app, "GET")).status).toBe(404);
    expect((await call(app, "PUT", { name: "Mine.woff2", data: b64(woff2) })).status).toBe(200);
    const res = await call(app, "GET");
    expect(res.headers.get("content-type")).toBe("font/woff2");
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString()).toBe("wOF2");
    expect((await call(app, "DELETE")).status).toBe(204);
    expect((await call(app, "GET")).status).toBe(404);
  });
});

describe("text font stack", () => {
  it("puts the chosen face first and keeps Satoshi as the fallback", () => {
    expect(fontStack({ kind: "satoshi" })).toMatch(/^"Satoshi"/);
    expect(fontStack({ kind: "anthropic" })).toMatch(/^"Anthropic Sans", "Satoshi"/);
    expect(fontStack({ kind: "installed", family: "Inter" })).toMatch(/^"Inter", "Satoshi"/);
    expect(fontStack({ kind: "upload", name: "x", version: 1 })).toMatch(/^"Distil Custom Text", "Satoshi"/);
  });

  it("strips characters that could break out of the CSS string", () => {
    expect(cleanFamily('Inter"; } body { display: none')).toBe("Inter body display none");
    expect(cleanFamily("  Noto   Sans  Devanagari ")).toBe("Noto Sans Devanagari");
  });
});
