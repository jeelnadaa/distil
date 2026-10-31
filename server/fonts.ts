import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AppError, notFound } from "./errors.ts";

// The learner's saved text fonts (F-1309): each one is either a font installed on this computer
// (kept by family name) or an uploaded file kept in the data folder, under a name of the learner's
// choosing, so it can be picked again later without adding it again.
// Uploaded files are accepted only in the four web font formats, recognised by signature, not name.
export const MAX_FONT_BYTES = 8 * 1024 * 1024;
const MAX_SAVED = 30;

const FORMATS = [
  { format: "woff2", type: "font/woff2", magic: [0x77, 0x4f, 0x46, 0x32] }, // "wOF2"
  { format: "woff", type: "font/woff", magic: [0x77, 0x4f, 0x46, 0x46] }, // "wOFF"
  { format: "opentype", type: "font/otf", magic: [0x4f, 0x54, 0x54, 0x4f] }, // "OTTO"
  { format: "truetype", type: "font/ttf", magic: [0x00, 0x01, 0x00, 0x00] },
  { format: "truetype", type: "font/ttf", magic: [0x74, 0x72, 0x75, 0x65] }, // "true"
] as const;

export type SavedFont =
  | { id: string; name: string; kind: "installed"; family: string; addedAt: number }
  | { id: string; name: string; kind: "file"; format: string; size: number; addedAt: number };

export const sniffFont = (bytes: Uint8Array) => FORMATS.find((f) => f.magic.every((b, i) => bytes[i] === b)) ?? null;

// Names end up in CSS strings and on pills, so only plain name characters are kept.
const cleanName = (name: string) => name.replace(/[^\p{L}\p{N} _.-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 80);

export function createFonts(dir: string, now = () => Date.now()) {
  const indexFile = join(dir, "fonts.json");
  const fileOf = (id: string) => join(dir, `${id}.font`);

  const write = (fonts: SavedFont[]) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${indexFile}.tmp`, JSON.stringify(fonts));
    renameSync(`${indexFile}.tmp`, indexFile);
  };

  // Before saved fonts there was one uploaded file ("text-font"); it becomes the first saved font.
  const legacy = join(dir, "text-font");
  if (!existsSync(indexFile) && existsSync(legacy)) {
    const meta = existsSync(`${legacy}.json`) ? JSON.parse(readFileSync(`${legacy}.json`, "utf8")) as { name?: string; updatedAt?: number } : {};
    const bytes = readFileSync(legacy);
    const kind = sniffFont(bytes);
    const id = randomUUID();
    if (kind) {
      renameSync(legacy, fileOf(id));
      write([{ id, name: cleanName(meta.name ?? "") || "Custom font", kind: "file", format: kind.format, size: bytes.length, addedAt: meta.updatedAt ?? now() }]);
    }
    rmSync(`${legacy}.json`, { force: true });
  }

  const list = (): SavedFont[] => (existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, "utf8")) : []);
  const get = (id: string) => list().find((f) => f.id === id) ?? (() => { throw notFound("Font"); })();
  const add = (font: SavedFont) => {
    const fonts = list();
    if (fonts.length >= MAX_SAVED) throw new AppError(400, "too_many_fonts", `You can keep up to ${MAX_SAVED} fonts. Remove one first.`);
    write([...fonts, font]);
    return font;
  };

  return {
    list,

    addInstalled(family: string, name?: string): SavedFont {
      const clean = cleanName(family);
      if (!clean) throw new AppError(400, "invalid_font", "Type the font's name as your computer lists it.");
      return add({ id: randomUUID(), name: cleanName(name ?? "") || clean, kind: "installed", family: clean, addedAt: now() });
    },

    addFile(fileName: string, base64: string, name?: string): SavedFont {
      const bytes = Buffer.from(base64, "base64");
      if (bytes.length > MAX_FONT_BYTES) throw new AppError(413, "font_too_large", "Font files can be up to 8 MB.");
      const kind = sniffFont(bytes);
      if (!kind) throw new AppError(400, "not_a_font", "That file isn't a .woff2, .woff, .ttf or .otf font.");
      const fallback = cleanName(fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ")) || "Custom font";
      const font: SavedFont = { id: randomUUID(), name: cleanName(name ?? "") || fallback, kind: "file", format: kind.format, size: bytes.length, addedAt: now() };
      mkdirSync(dir, { recursive: true });
      writeFileSync(fileOf(font.id), bytes);
      try {
        return add(font);
      } catch (err) {
        rmSync(fileOf(font.id), { force: true });
        throw err;
      }
    },

    rename(id: string, name: string): SavedFont {
      const clean = cleanName(name);
      if (!clean) throw new AppError(400, "invalid_name", "Give the font a name.");
      get(id);
      const fonts = list().map((f) => (f.id === id ? { ...f, name: clean } : f));
      write(fonts);
      return fonts.find((f) => f.id === id)!;
    },

    read(id: string): { bytes: Buffer; type: string } {
      if (get(id).kind !== "file" || !existsSync(fileOf(id))) throw notFound("Font file");
      const bytes = readFileSync(fileOf(id));
      const kind = sniffFont(bytes);
      if (!kind) throw notFound("Font file");
      return { bytes, type: kind.type };
    },

    remove(id: string) {
      get(id);
      write(list().filter((f) => f.id !== id));
      rmSync(fileOf(id), { force: true });
    },
  };
}

export type Fonts = ReturnType<typeof createFonts>;
