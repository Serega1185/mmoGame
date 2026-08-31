import { mineBandFor, rollOre, type OreId } from "./mineTables.ts";

export type NodeKind = "monster" | "elite" | "mystery" | "city" | "boss" | "mine";
export type ResolvedKind = "monster" | "elite" | "city" | "loot" | "boss" | "mine";

export type MarchNode = {
  id: string;
  floor: number;
  col: number;
  kind: NodeKind;
  ore?: OreId;
  resolved?: ResolvedKind;
  next: string[];
};

export type MarchState = {
  nodes: MarchNode[];
  current: string | null;
  pending: string | null;
  visited: string[];
  fled: string[];
  fledEdges: { from: string; to: string }[];
  pendingFight?: { kind: "normal" | "elite" | "boss" | "mine"; enemyIds: string[]; ore?: OreId } | null;
};

export type PublicMarch = {
  nodes: {
    id: string;
    floor: number;
    col: number;
    kind: NodeKind | "loot";
    ore?: OreId;
    next: string[];
  }[];
  current: string | null;
  pending: string | null;
  visited: string[];
  fled: string[];
  fledEdges: { from: string; to: string }[];
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
  return "loot";
}

export function generateMarch(depth = 1): MarchState {
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
  for (const floor of [6, 7, 8]) {
    for (const col of [0, 1, 2]) add(floor, col, randKind());
  }
  const cityCol = Math.floor(Math.random() * 3);
  for (const col of [0, 1, 2]) add(9, col, col === cityCol ? "city" : randKind());
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

  placeMines(nodes, depth);

  return { nodes, current: null, pending: null, visited: [], fled: [], fledEdges: [] };
}

export function placeMines(nodes: MarchNode[], depth: number, skipIds?: Iterable<string>) {
  const band = mineBandFor(depth);
  const n = band.minMines + Math.floor(Math.random() * (band.maxMines - band.minMines + 1));
  if (n <= 0) return;
  const skip = new Set(skipIds || []);
  const pool = nodes.filter(
    (node) =>
      node.kind !== "city" &&
      node.kind !== "boss" &&
      node.kind !== "mine" &&
      node.floor !== 10 &&
      !skip.has(node.id)
  );
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = a;
  }
  for (let i = 0; i < n && i < pool.length; i++) {
    const node = pool[i]!;
    node.kind = "mine";
    node.ore = rollOre(band.weights);
    node.resolved = undefined;
  }
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
      fled: Array.isArray(s.fled) ? s.fled.map(String) : [],
      fledEdges: Array.isArray(s.fledEdges)
        ? s.fledEdges
            .filter((e: { from?: unknown; to?: unknown }) => e && e.from && e.to)
            .map((e: { from: unknown; to: unknown }) => ({ from: String(e.from), to: String(e.to) }))
        : [],
      pendingFight: s.pendingFight && Array.isArray(s.pendingFight.enemyIds)
        ? {
            kind:
              s.pendingFight.kind === "elite" || s.pendingFight.kind === "boss" || s.pendingFight.kind === "mine"
                ? s.pendingFight.kind
                : "normal",
            enemyIds: s.pendingFight.enemyIds.map(String),
            ore: s.pendingFight.ore,
          }
        : null,
    };
  } catch {
    return null;
  }
}

export function openExits(state: MarchState): string[] {
  const blocked = new Set([...state.visited, ...state.fled]);
  if (!state.current) return state.nodes.filter((n) => n.floor === 1 && !blocked.has(n.id)).map((n) => n.id);
  const cur = state.nodes.find((n) => n.id === state.current);
  if (!cur) return state.nodes.filter((n) => n.floor === 1 && !blocked.has(n.id)).map((n) => n.id);
  return cur.next.filter((id) => !blocked.has(id));
}

export function reachableIds(state: MarchState): string[] {
  if (state.pending) return [];
  return openExits(state);
}

export function canFlee(state: MarchState): boolean {
  if (!state.pending) return false;
  return openExits(state).length > 1;
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
      ore: n.kind === "mine" ? n.ore : undefined,
      next: n.next,
    })),
    current: state.current,
    pending: state.pending,
    visited: state.visited,
    fled: state.fled,
    fledEdges: state.fledEdges,
    reachable: reachableIds(state),
  };
}

export function combatKind(resolved: ResolvedKind | NodeKind): "normal" | "elite" | "boss" | "mine" | null {
  if (resolved === "monster") return "normal";
  if (resolved === "elite") return "elite";
  if (resolved === "boss") return "boss";
  if (resolved === "mine") return "mine";
  return null;
}
