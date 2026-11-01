// Lesson prerequisites form a DAG (F-501). Orders are stable: of the lessons free to come next, the one
// earliest in the preferred order goes first, so a plan only moves what its prerequisites force.

export type Requires = Map<string, string[]>;

// Orders ids so each comes after everything it requires. Ids left over sit on (or behind) a cycle.
export function topoOrder(ids: string[], requires: Requires): { order: string[]; cycle: string[] } {
  const known = new Set(ids);
  const waiting = new Map(ids.map((id) => [id, new Set((requires.get(id) ?? []).filter((r) => known.has(r) && r !== id))]));
  const order: string[] = [];
  for (let placed = true; placed;) {
    placed = false;
    for (const id of ids) {
      if (!waiting.has(id) || waiting.get(id)!.size) continue;
      order.push(id);
      waiting.delete(id);
      for (const deps of waiting.values()) deps.delete(id);
      placed = true;
      break;
    }
  }
  return { order, cycle: [...waiting.keys()] };
}

// Breaks every cycle by keeping only the requirements that point back in the preferred order.
export function breakCycles(ids: string[], requires: Requires): Requires {
  const rank = new Map(ids.map((id, i) => [id, i]));
  const out: Requires = new Map();
  for (const id of ids) {
    const kept = (requires.get(id) ?? []).filter((r) => rank.has(r) && rank.get(r)! < rank.get(id)!);
    if (kept.length) out.set(id, [...new Set(kept)]);
  }
  return out;
}

// Pairs [lesson, prerequisite] where the lesson comes first in `order`: an edit that would create one is refused.
export function misplaced(order: string[], requires: Requires): [string, string][] {
  const rank = new Map(order.map((id, i) => [id, i]));
  const out: [string, string][] = [];
  for (const id of order) {
    for (const r of requires.get(id) ?? []) if (rank.has(r) && rank.get(r)! > rank.get(id)!) out.push([id, r]);
  }
  return out;
}
