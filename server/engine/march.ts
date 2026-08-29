export type NodeKind = "monster" | "elite" | "mystery" | "city" | "boss";
export type ResolvedKind = "monster" | "elite" | "city" | "loot" | "boss";

export type MarchNode = {
  id: string;
  floor: number;
  col: number;
  kind: NodeKind;
  resolved?: ResolvedKind;
  next: string[];
};

export type MarchState = {
  nodes: MarchNode[];
  current: string | null;
  pending: string | null;
  visited: string[];
};

export type PublicMarch = {
  nodes: {
    id: string;
    floor: number;
    col: number;
    kind: NodeKind | "loot";
    next: string[];
  }[];
  current: string | null;
  pending: string | null;
  visited: string[];
  reachable: string[];
};

function nid(floor: number, col: number) {
  return `f${floor}c${col}`;
}

function randKind(): "monster" | "elite" | "mystery" {
  const r = Math.random();
  if (r < 0.5) return "monster";
  if (r < 0.78) return "elite";
  return "mystery";
}

export function rollMystery(): ResolvedKind {
  const r = Math.random();
  if (r < 0.25) return "monster";
  if (r < 0.5) return "elite";
  if (r < 0.75) return "city";
  return "loot";
}

export function generateMarch(): MarchState {
  const nodes: MarchNode[] = [];
  const byId = new Map<string, MarchNode>();

  function add(floor: number, col: number, kind: NodeKind) {
    const node: MarchNode = { id: nid(floor, col), floor, col, kind, next: [] };
    nodes.push(node);
    byId.set(node.id, node);
    return node;
  }

  for (const col of [0, 1, 2]) add(1, col, "monster");
  for (const floor of [2, 3, 4]) {
    for (const col of [0, 1, 2]) add(floor, col, randKind());
  }
  add(5, 1, "city");
  for (const floor of [6, 7, 8, 9]) {
    for (const col of [0, 1, 2]) add(floor, col, randKind());
  }
  add(10, 1, "boss");

  function link(a: string, b: string) {
    const n = byId.get(a);
    if (!n || n.next.includes(b)) return;
    n.next.push(b);
  }

  function weave(fromFloor: number, toFloor: number) {
    const cols = [0, 1, 2];
    for (const c of cols) {
      const from = nid(fromFloor, c);
      link(from, nid(toFloor, c));
      if (c > 0 && Math.random() < 0.55) link(from, nid(toFloor, c - 1));
      if (c < 2 && Math.random() < 0.55) link(from, nid(toFloor, c + 1));
      if (!byId.get(from)!.next.length) link(from, nid(toFloor, c));
    }
    for (const c of cols) {
      const dest = nid(toFloor, c);
      const hasIn = nodes.some((n) => n.floor === fromFloor && n.next.includes(dest));
      if (!hasIn) {
        const nearest = cols.reduce((best, x) => (Math.abs(x - c) < Math.abs(best - c) ? x : best));
        link(nid(fromFloor, nearest), dest);
      }
    }
  }

  weave(1, 2);
  weave(2, 3);
  weave(3, 4);
  for (const c of [0, 1, 2]) link(nid(4, c), nid(5, 1));
  for (const c of [0, 1, 2]) link(nid(5, 1), nid(6, c));
  weave(6, 7);
  weave(7, 8);
  weave(8, 9);
  for (const c of [0, 1, 2]) link(nid(9, c), nid(10, 1));

  const extraCityPool = nodes.filter((n) => n.floor !== 1 && n.floor !== 5 && n.floor !== 10 && n.kind !== "city" && n.kind !== "boss");
  if (extraCityPool.length) {
    const extra = extraCityPool[Math.floor(Math.random() * extraCityPool.length)]!;
    extra.kind = "city";
  }

  return { nodes, current: null, pending: null, visited: [] };
}

export function parseMarch(raw: unknown): MarchState | null {
  try {
    const s = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!s || !Array.isArray(s.nodes) || s.nodes.length < 10) return null;
    return {
      nodes: s.nodes,
      current: s.current ?? null,
      pending: s.pending ?? null,
      visited: Array.isArray(s.visited) ? s.visited.map(String) : [],
    };
  } catch {
    return null;
  }
}

export function reachableIds(state: MarchState): string[] {
  if (state.pending) return [];
  if (!state.current) return state.nodes.filter((n) => n.floor === 1).map((n) => n.id);
  const cur = state.nodes.find((n) => n.id === state.current);
  if (!cur) return state.nodes.filter((n) => n.floor === 1).map((n) => n.id);
  return cur.next.filter((id) => !state.visited.includes(id));
}

export function displayKind(node: MarchNode, pending: string | null): NodeKind | "loot" {
  if (node.kind === "mystery" && !node.resolved && node.id !== pending) return "mystery";
  return node.resolved || node.kind;
}

export function toPublicMarch(state: MarchState): PublicMarch {
  return {
    nodes: state.nodes.map((n) => ({
      id: n.id,
      floor: n.floor,
      col: n.col,
      kind: displayKind(n, state.pending),
      next: n.next,
    })),
    current: state.current,
    pending: state.pending,
    visited: state.visited,
    reachable: reachableIds(state),
  };
}

export function combatKind(resolved: ResolvedKind | NodeKind): "normal" | "elite" | "boss" | null {
  if (resolved === "monster") return "normal";
  if (resolved === "elite") return "elite";
  if (resolved === "boss") return "boss";
  return null;
}
