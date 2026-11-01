import type { Db } from "../db.ts";

// The ledger in reading order, grouped by the section each item was first found in. Planning works one
// part at a time (a few sections, at most PART_ITEMS items), so a 1,000-item textbook never goes to the
// model in one call while code still checks every item.

export const PART_ITEMS = 150;
export type PlanItem = { id: string; type: string; title: string; section: string };

// In-scope items of a folder and its subfolders: by material (in the order added), then page, then when found.
// Items without a source (added by hand or from an answer) come last.
export function itemsInOrder(db: Db, folderId: string): PlanItem[] {
  const rows = db.prepare(`
    WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id),
    first AS (
      SELECT s.item_id, m.name, m.created_at AS m_at, s.loc, c.headings,
        ROW_NUMBER() OVER (PARTITION BY s.item_id ORDER BY m.created_at, s.loc) AS n
      FROM item_sources s JOIN materials m ON m.id = s.material_id JOIN chunks c ON c.id = s.chunk_id
    )
    SELECT i.id, i.type, i.title, f.name, f.headings FROM items i JOIN sub ON i.folder_id = sub.id
    LEFT JOIN first f ON f.item_id = i.id AND f.n = 1
    WHERE i.mark IS NULL
    ORDER BY f.m_at IS NULL, f.m_at, f.loc, i.created_at, i.rowid`).all(folderId) as { id: string; type: string; title: string; name: string | null; headings: string | null }[];
  return rows.map((r) => {
    const heading = r.headings ? (JSON.parse(r.headings) as string[])[0] : undefined;
    return { id: r.id, type: r.type, title: r.title, section: r.name ? `${r.name}${heading ? ` › ${heading}` : ""}` : "Added by you" };
  });
}

// Consecutive sections packed into parts of at most `max` items; a section larger than that is split.
export function parts(items: PlanItem[], max = PART_ITEMS): PlanItem[][] {
  const sections: PlanItem[][] = [];
  for (const item of items) {
    const last = sections.at(-1);
    if (last && last[0]!.section === item.section) last.push(item);
    else sections.push([item]);
  }
  const out: PlanItem[][] = [];
  for (const section of sections) {
    for (let i = 0; i < section.length; i += max) {
      const piece = section.slice(i, i + max);
      const last = out.at(-1);
      if (last && last.length + piece.length <= max) last.push(...piece);
      else out.push(piece);
    }
  }
  return out;
}

// Section headings with item counts, in reading order (for the Brief Compiler's view of the ledger).
export const sectionList = (items: PlanItem[]) => {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.section, (counts.get(i.section) ?? 0) + 1);
  return [...counts].map(([section, n]) => `${section} (${n})`);
};
