import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AppError } from "./errors.ts";

// The learner's own text font (F-1309), uploaded once and kept in the data folder.
// Only the four web font formats are accepted, recognised by their signature, not their file name.
export const MAX_FONT_BYTES = 8 * 1024 * 1024;

const FORMATS = [
  { format: "woff2", type: "font/woff2", magic: [0x77, 0x4f, 0x46, 0x32] }, // "wOF2"
  { format: "woff", type: "font/woff", magic: [0x77, 0x4f, 0x46, 0x46] }, // "wOFF"
  { format: "opentype", type: "font/otf", magic: [0x4f, 0x54, 0x54, 0x4f] }, // "OTTO"
  { format: "truetype", type: "font/ttf", magic: [0x00, 0x01, 0x00, 0x00] },
  { format: "truetype", type: "font/ttf", magic: [0x74, 0x72, 0x75, 0x65] }, // "true"
] as const;

export type FontInfo = { name: string; format: string; size: number; updatedAt: number };

export const sniffFont = (bytes: Uint8Array) => FORMATS.find((f) => f.magic.every((b, i) => bytes[i] === b)) ?? null;

export function createFonts(dir: string, now = () => Date.now()) {
  const fontFile = join(dir, "text-font");
  const metaFile = join(dir, "text-font.json");

  const info = (): FontInfo | null => (existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, "utf8")) : null);

  return {
    info,

    save(fileName: string, base64: string): FontInfo {
      const bytes = Buffer.from(base64, "base64");
      if (bytes.length > MAX_FONT_BYTES) throw new AppError(413, "font_too_large", "Font files can be up to 8 MB.");
      const kind = sniffFont(bytes);
      if (!kind) throw new AppError(400, "not_a_font", "That file isn't a .woff2, .woff, .ttf or .otf font.");
      const name = fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim().slice(0, 80) || "Custom font";
      const meta: FontInfo = { name, format: kind.format, size: bytes.length, updatedAt: now() };
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${fontFile}.tmp`, bytes);
      renameSync(`${fontFile}.tmp`, fontFile);
      writeFileSync(metaFile, JSON.stringify(meta));
      return meta;
    },

    read(): { bytes: Buffer; type: string } | null {
      if (!existsSync(fontFile)) return null;
      const bytes = readFileSync(fontFile);
      const kind = sniffFont(bytes);
      return kind ? { bytes, type: kind.type } : null;
    },

    remove() {
      rmSync(fontFile, { force: true });
      rmSync(metaFile, { force: true });
    },
  };
}

export type Fonts = ReturnType<typeof createFonts>;
