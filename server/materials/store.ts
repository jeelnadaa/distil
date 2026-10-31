import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Db, transaction } from "../db.ts";
import { AppError, notFound } from "../errors.ts";
import type { Chunk } from "./chunk.ts";
import { detectKind, type LocUnit, type MaterialKind } from "./parse.ts";
import { imageMime } from "./render.ts";

// Materials (F-201…F-206): Distil keeps its own copy of each file (owner decision), so moving or
// deleting the original never breaks a subject. A folder sees its own materials and its ancestors' (F-003).

export const MAX_MATERIAL_BYTES = 200 * 1024 * 1024;

export type MaterialStatus = "queued" | "parsing" | "ready" | "error";
export type Material = {
  id: string; folderId: string; kind: MaterialKind; name: string; size: number; sha256: string;
  status: MaterialStatus; error: string | null; unit: LocUnit | null; length: number | null;
  chunks: number; tokens: number; distilled: number; visual: number[]; source: string | null; createdAt: number;
};
export type StoredChunk = {
  id: string; ord: number; from: number; to: number; headings: string[]; text: string; tokens: number;
  marks: [number, number][]; extracted: boolean; auditRounds: number; audited: boolean;
};

type Row = {
  id: string; folder_id: string; kind: MaterialKind; name: string; size: number; sha256: string; status: MaterialStatus;
  error: string | null; unit: LocUnit | null; length: number | null; created_at: number; chunks: number; tokens: number; distilled: number; visual: string; source: string | null;
};
const toMaterial = (r: Row): Material => ({
  id: r.id, folderId: r.folder_id, kind: r.kind, name: r.name, size: r.size, sha256: r.sha256, status: r.status,
  error: r.error, unit: r.unit, length: r.length, chunks: r.chunks, tokens: r.tokens, distilled: r.distilled, visual: JSON.parse(r.visual) as number[], source: r.source, createdAt: r.created_at,
});

const SELECT = `SELECT m.*, COUNT(c.id) AS chunks, COALESCE(SUM(c.tokens), 0) AS tokens,
  COUNT(CASE WHEN c.audit_done = 1 THEN 1 END) AS distilled
  FROM materials m LEFT JOIN chunks c ON c.material_id = m.id`;

const MIME: Record<MaterialKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  markdown: "text/markdown; charset=utf-8",
  text: "text/plain; charset=utf-8",
  image: "application/octet-stream",
};

export function createMaterials(db: Db, dir: string, now = () => Date.now()) {
  const fileOf = (id: string) => join(dir, id, "original");

  const get = (id: string): Material => {
    const row = db.prepare(`${SELECT} WHERE m.id = ? GROUP BY m.id`).get(id) as Row | undefined;
    if (!row) throw notFound("Material");
    return toMaterial(row);
  };

  const ancestors = (folderId: string): string[] => {
    const ids: string[] = [];
    let current: string | null = folderId;
    while (current) {
      const row = db.prepare("SELECT id, parent_id FROM folders WHERE id = ?").get(current) as { id: string; parent_id: string | null } | undefined;
      if (!row) break;
      ids.push(row.id);
      current = row.parent_id;
    }
    return ids;
  };

  return {
    get,

    // source: the link a fetched material came from.
    add(folderId: string, fileName: string, bytes: Uint8Array, source: string | null = null): Material {
      if (!ancestors(folderId).length) throw notFound("Folder");
      if (!bytes.length) throw new AppError(400, "empty_file", "That file is empty.");
      if (bytes.length > MAX_MATERIAL_BYTES) throw new AppError(413, "file_too_large", "Files can be up to 200 MB.");
      const name = fileName.replace(/[\\/]/g, "_").trim().slice(0, 200) || "Untitled";
      const kind = detectKind(name, bytes);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const existing = db.prepare("SELECT name FROM materials WHERE folder_id = ? AND sha256 = ?").get(folderId, sha256) as { name: string } | undefined;
      if (existing) throw new AppError(409, "duplicate_material", `This ${source ? "page" : "file"} is already in this folder as “${existing.name}”.`);
      const id = randomUUID();
      mkdirSync(join(dir, id), { recursive: true });
      writeFileSync(fileOf(id), bytes);
      db.prepare("INSERT INTO materials (id, folder_id, kind, name, size, sha256, status, source, created_at) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)")
        .run(id, folderId, kind, name, bytes.length, sha256, source, now());
      return get(id);
    },

    // The folder's own materials first, then inherited ones from the nearest ancestor up.
    list(folderId: string): (Material & { inherited: boolean })[] {
      return ancestors(folderId).flatMap((id, depth) =>
        (db.prepare(`${SELECT} WHERE m.folder_id = ? GROUP BY m.id ORDER BY m.created_at`).all(id) as Row[])
          .map((r) => ({ ...toMaterial(r), inherited: depth > 0 })));
    },

    read(id: string): { bytes: Buffer; type: string } {
      const material = get(id);
      const bytes = readFileSync(fileOf(id));
      return { bytes, type: material.kind === "image" ? imageMime(bytes) : MIME[material.kind] };
    },

    setStatus(id: string, status: MaterialStatus, error: string | null = null) {
      db.prepare("UPDATE materials SET status = ?, error = ? WHERE id = ?").run(status, error, id);
    },

    // Replaces the material's chunks in one transaction, so a re-parse never leaves a half-written set.
    saveChunks(id: string, unit: LocUnit, length: number, chunks: Chunk[], visual: number[] = []) {
      transaction(db, () => {
        db.prepare("DELETE FROM chunks WHERE material_id = ?").run(id);
        const insert = db.prepare("INSERT INTO chunks (id, material_id, ord, loc_from, loc_to, headings, text, tokens, marks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
        chunks.forEach((c, i) => insert.run(randomUUID(), id, i, c.anchor.from, c.anchor.to, JSON.stringify(c.headings), c.text, c.tokens, JSON.stringify(c.marks)));
        db.prepare("UPDATE materials SET status = 'ready', error = NULL, unit = ?, length = ?, visual = ? WHERE id = ?").run(unit, length, JSON.stringify(visual), id);
      });
    },

    chunks(id: string): StoredChunk[] {
      return (db.prepare("SELECT * FROM chunks WHERE material_id = ? ORDER BY ord").all(id) as {
        id: string; ord: number; loc_from: number; loc_to: number; headings: string; text: string; tokens: number;
        marks: string; extracted_at: number | null; audit_rounds: number; audit_done: number;
      }[]).map((r) => ({
        id: r.id, ord: r.ord, from: r.loc_from, to: r.loc_to, headings: JSON.parse(r.headings), text: r.text, tokens: r.tokens,
        marks: JSON.parse(r.marks), extracted: r.extracted_at !== null, auditRounds: r.audit_rounds, audited: r.audit_done === 1,
      }));
    },

    // Extraction progress lives on each chunk, so a stopped or restarted job carries on where it left off.
    markExtracted(chunkId: string) {
      db.prepare("UPDATE chunks SET extracted_at = ? WHERE id = ?").run(now(), chunkId);
    },
    markAudited(chunkId: string, done: boolean) {
      db.prepare("UPDATE chunks SET audit_rounds = audit_rounds + 1, audit_done = ? WHERE id = ?").run(done ? 1 : 0, chunkId);
    },
    // "What did we miss?" (F-309): audit every chunk again.
    resetAudit(materialId: string) {
      db.prepare("UPDATE chunks SET audit_rounds = 0, audit_done = 0 WHERE material_id = ?").run(materialId);
    },

    remove(id: string) {
      get(id);
      db.prepare("DELETE FROM materials WHERE id = ?").run(id);
      rmSync(join(dir, id), { recursive: true, force: true });
    },

    // Material ids under a folder and its subfolders, so their files can be removed when the folder is deleted.
    idsUnder(folderId: string): string[] {
      return (db.prepare(`WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id)
        SELECT m.id FROM materials m JOIN sub ON m.folder_id = sub.id`).all(folderId) as { id: string }[]).map((r) => r.id);
    },

    removeFiles(ids: string[]) {
      for (const id of ids) rmSync(join(dir, id), { recursive: true, force: true });
    },
  };
}

export type Materials = ReturnType<typeof createMaterials>;
