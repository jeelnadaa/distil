import { strToU8, zipSync } from "fflate";

// Builds a small, valid PDF with one text line per entry on each page (Helvetica, no compression).
export function makePdf(pages: string[][]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((lines, i) => {
    const content = lines.map((line, j) => `BT /F1 12 Tf 72 ${720 - j * 18} Td (${esc(line)}) Tj ET`).join("\n");
    objects[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objects[5 + i * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return strToU8(out);
}

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A minimal .docx: paragraphs given as [style, text]; style "Heading1"… or "" for body text.
export function makeDocx(paragraphs: [string, string][]): Uint8Array {
  const body = paragraphs.map(([style, text]) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r></w:p>`).join("");
  return zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    "word/document.xml": strToU8(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`),
  });
}

// A minimal .pptx: one entry per slide, each a list of paragraphs (the first is the title); optional notes.
export function makePptx(slides: { lines: string[]; notes?: string }[]): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
  };
  const para = (t: string) => `<a:p><a:r><a:t>${xmlEsc(t)}</a:t></a:r></a:p>`;
  slides.forEach((slide, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = strToU8(
      `<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody>${slide.lines.map(para).join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
    if (slide.notes) files[`ppt/notesSlides/notesSlide${i + 1}.xml`] = strToU8(
      `<?xml version="1.0"?><p:notes xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody>${para(slide.notes)}</p:txBody></p:sp></p:spTree></p:cSld></p:notes>`);
  });
  return zipSync(files);
}
