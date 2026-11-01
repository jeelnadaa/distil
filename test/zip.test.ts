import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Zip } from "fflate";
import { describe, expect, it } from "vitest";
import { unzipTo, ZipEntry } from "../server/zip.ts";

// fflate's streaming deflate wrote invalid data for this font, so these are the bytes that once broke a release.
const font = readFileSync(join(import.meta.dirname, "../node_modules/katex/dist/fonts/KaTeX_SansSerif-Bold.ttf"));

function zipOf(files: Record<string, { bytes: Uint8Array; level: number }>) {
  const parts: Uint8Array[] = [];
  const zip = new Zip((err, chunk) => {
    if (err) throw err;
    parts.push(chunk);
  });
  for (const [name, { bytes, level }] of Object.entries(files)) {
    const entry = new ZipEntry(name, level);
    zip.add(entry);
    for (let at = 0; at < bytes.length; at += 4096) entry.push(bytes.subarray(at, at + 4096) as Uint8Array<ArrayBuffer>);
    entry.push(new Uint8Array(0), true);
  }
  zip.end();
  return Buffer.concat(parts);
}

describe("ZipEntry", () => {
  it("round-trips a file through the app's unzip, in chunks and at each level", async () => {
    const dir = mkdtempSync(join(tmpdir(), "distil-zip-"));
    const file = join(dir, "test.zip");
    writeFileSync(file, zipOf({ "a/deflated.ttf": { bytes: font, level: 6 }, "stored.ttf": { bytes: font, level: 0 }, "empty.txt": { bytes: new Uint8Array(0), level: 6 } }));
    const out = join(dir, "out");
    await unzipTo(file, out, () => true, "a test zip");
    expect(readFileSync(join(out, "a", "deflated.ttf")).equals(font)).toBe(true);
    expect(readFileSync(join(out, "stored.ttf")).equals(font)).toBe(true);
    expect(readFileSync(join(out, "empty.txt")).length).toBe(0);
  });
});
