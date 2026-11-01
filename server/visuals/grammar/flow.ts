// `flow` (F-701): processes, flowcharts and mind maps; `map` (F-707): concept maps of propositions.
// Both are data only; layout and look are the renderer's.

import { GrammarError, header, limit, linesOf, type Mark, oneAccent, rejectStyling, takeMarks, title } from "./common.ts";

export type FlowShape = "box" | "decision" | "round";
export type FlowNode = { id: string; label: string; shape: FlowShape; mark: Mark };
export type FlowEdge = { from: string; to: string; label?: string; mark: Mark };
export type FlowSpec = { kind: "flow"; title?: string; dir: "TB" | "LR"; nodes: FlowNode[]; edges: FlowEdge[] };
export type MapSpec = { kind: "map"; title?: string; nodes: { id: string; label: string; mark: Mark }[]; edges: FlowEdge[] };

const MAX_NODES = 40;
const MAX_EDGES = 80;

// "sig[Signal]", "q{Aliasing?}", "done(Done)!" or a bare id; marks may follow the closing bracket.
const NODE = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[([^\]]*)\]|\{([^}]*)\}|\(([^)]*)\))?([!~]?)/;
// "->", "-yes->" (labelled), "~>" and "~maybe~>" (muted).
const ARROW = /^(?:-(?:([^>]*?)-)?>|~(?:([^>]*?)~)?>)/;

export function parseFlow(source: string): FlowSpec {
  const { title: name, rest } = title(linesOf(source));
  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];
  let dir: FlowSpec["dir"] = "TB";

  const node = (id: string, label: string | undefined, shape: FlowShape | undefined, n: number) => {
    const existing = nodes.get(id);
    if (label !== undefined) {
      rejectStyling(label, n);
      if (existing && existing.label !== id && existing.label !== label) throw new GrammarError(`Node "${id}" is labelled twice ("${existing.label}" and "${label}").`, n);
    }
    const next = existing ?? { id, label: id, shape: "box" as FlowShape, mark: {} };
    if (label !== undefined) next.label = label.trim() || id;
    if (shape) next.shape = shape;
    nodes.set(id, next);
    return next;
  };

  for (const line of rest) {
    const d = header(line, "dir");
    if (d !== null) {
      if (d !== "TB" && d !== "LR") throw new GrammarError(`dir must be TB (top to bottom) or LR (left to right), not "${d}".`, line.n);
      dir = d;
      continue;
    }
    const { text, mark: lineMark } = takeMarks(line.text, line.n);
    let rest = text;
    let edgeLabel: string | undefined;
    const chain: { node: FlowNode; arrow?: { label?: string; muted: boolean } }[] = [];
    for (;;) {
      const m = rest.match(NODE);
      if (!m) throw new GrammarError(`Expected a node such as a[Label], b{Question?} or c(End) at "${rest.slice(0, 20)}".`, line.n);
      const shape: FlowShape | undefined = m[2] !== undefined ? "box" : m[3] !== undefined ? "decision" : m[4] !== undefined ? "round" : undefined;
      const current = node(m[1]!, m[2] ?? m[3] ?? m[4], shape, line.n);
      if (m[5] === "!") current.mark.emphasis = true;
      if (m[5] === "~") current.mark.muted = true;
      chain.push({ node: current });
      rest = rest.slice(m[0].length).trimStart();
      if (!rest) break;
      if (rest.startsWith(":")) {
        edgeLabel = rest.slice(1).trim();
        rejectStyling(edgeLabel, line.n);
        break;
      }
      const a = rest.match(ARROW);
      if (!a) throw new GrammarError(`Expected an arrow (->, -label->, ~>) at "${rest.slice(0, 20)}".`, line.n);
      chain[chain.length - 1]!.arrow = { label: (a[1] ?? a[2])?.trim() || undefined, muted: a[0].startsWith("~") };
      rest = rest.slice(a[0].length).trimStart();
    }
    if (chain.length === 1 && edgeLabel !== undefined) throw new GrammarError("A label after : needs an edge (a -> b: label).", line.n);
    Object.assign(chain[chain.length - 1]!.node.mark, lineMark);
    for (let i = 0; i < chain.length - 1; i++) {
      const { node: from, arrow } = chain[i]!;
      const label = arrow!.label ?? (i === chain.length - 2 ? edgeLabel : undefined);
      if (label) rejectStyling(label, line.n);
      edges.push({ from: from.id, to: chain[i + 1]!.node.id, ...(label ? { label } : {}), mark: arrow!.muted ? { muted: true } : {} });
    }
  }
  if (!nodes.size) throw new GrammarError("The flow has no nodes.");
  limit(nodes.size, MAX_NODES, "nodes");
  limit(edges.length, MAX_EDGES, "edges");
  return { kind: "flow", ...(name ? { title: name } : {}), dir, nodes: oneAccent([...nodes.values()]), edges };
}

// Concept map lines are propositions: "Force -causes-> Acceleration". Nodes are named by their label.
export function parseMap(source: string): MapSpec {
  const { title: name, rest } = title(linesOf(source));
  const nodes = new Map<string, MapSpec["nodes"][number]>();
  const edges: FlowEdge[] = [];
  const node = (label: string, n: number) => {
    const clean = label.trim();
    if (!clean) throw new GrammarError("A concept is empty.", n);
    if (clean.length > 80) throw new GrammarError("A concept is too long (80 characters max).", n);
    rejectStyling(clean, n);
    const id = clean.toLowerCase();
    const found = nodes.get(id) ?? { id, label: clean, mark: {} };
    nodes.set(id, found);
    return found;
  };
  for (const line of rest) {
    const { text, mark } = takeMarks(line.text, line.n);
    const parts = text.split(/\s+(?:-([^>]*?)->|->)\s+/);
    // split keeps the captured relation between the concepts: [concept, relation, concept, relation, …]
    if (parts.length === 1) { Object.assign(node(text, line.n).mark, mark); continue; }
    let last = node(parts[0]!, line.n);
    for (let i = 1; i < parts.length; i += 2) {
      const next = node(parts[i + 1] ?? "", line.n);
      const label = parts[i]?.trim();
      if (label) rejectStyling(label, line.n);
      edges.push({ from: last.id, to: next.id, ...(label ? { label } : {}), mark: {} });
      last = next;
    }
    Object.assign(last.mark, mark);
  }
  if (!nodes.size) throw new GrammarError("The map has no concepts.");
  limit(nodes.size, MAX_NODES, "concepts");
  limit(edges.length, MAX_EDGES, "relations");
  return { kind: "map", ...(name ? { title: name } : {}), nodes: oneAccent([...nodes.values()]), edges };
}
