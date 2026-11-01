import type { Db } from "../db.ts";

// Chunk vectors per embedding model, stored as float32 and compared by cosine similarity.
const pack = (v: number[]) => {
  const f = new Float32Array(v);
  return new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
};
const unpack = (b: Uint8Array) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function createVectors(db: Db) {
  // folderId null: every folder.
  const scope = (folderId: string | null) => (folderId ? "AND m.folder_id = ?" : "");
  const args = (folderId: string | null) => (folderId ? [folderId] : []);

  return {
    // Chunks of ready materials that have no vector for this model yet, in reading order.
    missing(model: string, folderId: string | null, limit: number) {
      return db.prepare(`SELECT c.id, c.headings, c.text FROM chunks c JOIN materials m ON m.id = c.material_id
        WHERE m.status = 'ready' ${scope(folderId)} AND NOT EXISTS (SELECT 1 FROM chunk_vectors v WHERE v.chunk_id = c.id AND v.model = ?)
        ORDER BY m.created_at, c.ord LIMIT ?`).all(...args(folderId), model, limit) as { id: string; headings: string; text: string }[];
    },
    counts(model: string, folderId: string | null) {
      return db.prepare(`SELECT COUNT(*) AS total, SUM(EXISTS (SELECT 1 FROM chunk_vectors v WHERE v.chunk_id = c.id AND v.model = ?)) AS done
        FROM chunks c JOIN materials m ON m.id = c.material_id WHERE m.status = 'ready' ${scope(folderId)}`)
        .get(model, ...args(folderId)) as { total: number; done: number | null };
    },
    put(model: string, rows: { chunkId: string; vector: number[] }[]) {
      const insert = db.prepare("INSERT OR REPLACE INTO chunk_vectors (chunk_id, model, vec) VALUES (?, ?, ?)");
      for (const r of rows) insert.run(r.chunkId, model, pack(r.vector));
    },
    // The folder's chunks closest to the query vector.
    nearest(model: string, folderId: string, query: number[], limit: number) {
      const rows = db.prepare(`SELECT v.chunk_id, v.vec FROM chunk_vectors v JOIN chunks c ON c.id = v.chunk_id
        JOIN materials m ON m.id = c.material_id WHERE v.model = ? AND m.folder_id = ?`).all(model, folderId) as { chunk_id: string; vec: Uint8Array }[];
      return rows.map((r) => ({ chunkId: r.chunk_id, score: cosine(query, unpack(r.vec)) }))
        .sort((a, b) => b.score - a.score).slice(0, limit);
    },
    // Removes one model's vectors, e.g. when its local model is deleted.
    drop(model: string) {
      db.prepare("DELETE FROM chunk_vectors WHERE model = ?").run(model);
    },
  };
}

export type Vectors = ReturnType<typeof createVectors>;
