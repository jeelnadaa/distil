import { closeSync, createReadStream, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { Unzip, UnzipInflate } from "fflate";
import { AppError } from "./errors.ts";

const SAFE = /^[\w.@+-]+$/;
// A relative path of plain names: no drive, no "..", no backslashes.
export const safePath = (name: string) => name.split("/").every((p) => SAFE.test(p) && p !== "." && p !== "..");
// Any relative path that stays inside the folder (no drive, root, backslash or "..").
export const insidePath = (name: string) => !/[\\:]/.test(name) && name.split("/").every((p) => p !== "" && p !== "." && p !== "..");

// Streams a zip file into dir. Every entry must pass allowed(name); the first that doesn't stops it.
export async function unzipTo(zipFile: string, dir: string, allowed: (name: string) => boolean, what: string) {
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  let failure = null as Error | null; // set from the callbacks
  unzip.onfile = (file) => {
    if (failure || file.name.endsWith("/")) return;
    if (!allowed(file.name)) { failure = new AppError(400, "bad_zip", `This isn't ${what}: it holds ${file.name}.`); return; }
    const target = join(dir, ...file.name.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    const fd = openSync(target, "w");
    file.ondata = (err, data, final) => {
      if (err) { failure ??= err; closeSync(fd); return; }
      writeSync(fd, data);
      if (final) closeSync(fd);
    };
    file.start();
  };
  for await (const chunk of createReadStream(zipFile)) {
    unzip.push(chunk as Uint8Array);
    if (failure) break;
  }
  if (!failure) unzip.push(new Uint8Array(0), true);
  if (failure) throw failure instanceof AppError ? failure : new AppError(400, "bad_zip", `${what[0]!.toUpperCase()}${what.slice(1)} couldn't be read; it may be damaged.`);
}
