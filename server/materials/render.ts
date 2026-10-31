import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ImagePart } from "../providers/types.ts";

// Page images for vision extraction: formulas, diagrams and tables that PDFs draw as vector paths or
// pictures never reach the text layer, so pages flagged as visual are rendered and sent with their text.
// pdf.js draws with @napi-rs/canvas (its own optional dependency), so this needs no browser.

const WIDTH = 1000; // px: small text and sub/superscripts stay legible, about four image tiles per page
const JPEG_QUALITY = 85;

// pdf.js types its Node canvas factory loosely; this is the part used here.
type CanvasFactory = { create: (w: number, h: number) => { canvas: { toBuffer: (type: string, quality?: number) => Buffer } } };

export type PdfRenderer = { render: (pages: number[]) => Promise<ImagePart[]>; close: () => Promise<void> };

// Opens a PDF once so a job can render many of its pages without re-reading the file each time.
export async function openPdfRenderer(bytes: Uint8Array): Promise<PdfRenderer> {
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise;
  return {
    async render(pages) {
      const images: ImagePart[] = [];
      for (const n of pages) {
        if (n < 1 || n > doc.numPages) continue;
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale: WIDTH / page.getViewport({ scale: 1 }).width });
        const { canvas } = (doc.canvasFactory as CanvasFactory).create(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
        images.push({ mime: "image/jpeg", data: canvas.toBuffer("image/jpeg", JPEG_QUALITY).toString("base64") });
        page.cleanup();
      }
      return images;
    },
    close: () => task.destroy(),
  };
}

// The real type of an image file, from its first bytes.
export function imageMime(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  return "image/webp";
}
