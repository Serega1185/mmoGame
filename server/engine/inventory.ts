import { db } from "../db.ts";
import { CONFIG } from "../config.ts";
import type { InstanceRow } from "./items.ts";

export type Grid = (string | null)[][];

export function emptyGrid(cols = CONFIG.GRID_COLS, rows = CONFIG.GRID_ROWS): Grid {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
}

export function dims(item: { width: number; height: number; rotated: number }) {
  return item.rotated
    ? { w: item.height, h: item.width }
    : { w: item.width, h: item.height };
}

export function buildGrid(items: InstanceRow[], cols?: number, rows?: number): Grid {
  const g = emptyGrid(cols ?? CONFIG.GRID_COLS, rows ?? CONFIG.GRID_ROWS);
  for (const it of items) {
    if (it.grid_x == null || it.grid_y == null) continue;
    const { w, h } = dims(it);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const yy = it.grid_y + y;
        const xx = it.grid_x + x;
        if (g[yy] && xx < (g[yy]!.length)) g[yy]![xx] = it.id;
      }
    }
  }
  return g;
}

export function canPlace(
  grid: Grid,
  item: { id: string; width: number; height: number; rotated: number },
  x: number,
  y: number
) {
  const { w, h } = dims(item);
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  if (x < 0 || y < 0 || x + w > cols || y + h > rows) return false;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const occ = grid[y + dy]![x + dx];
      if (occ && occ !== item.id) return false;
    }
  }
  return true;
}

export function findPlace(
  grid: Grid,
  item: { id: string; width: number; height: number; rotated: number }
): { x: number; y: number; rotated: number } | null {
  const tryRot = [item.rotated, item.rotated ? 0 : 1];
  for (const rotated of tryRot) {
    const probe = { ...item, rotated };
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < (grid[0]?.length ?? 0); x++) {
        if (canPlace(grid, probe, x, y)) return { x, y, rotated };
      }
    }
  }
  return null;
}

export function storageCapacity(level: number) {
  return CONFIG.STORAGE_START_SIZE + (level - 1) * CONFIG.STORAGE_SIZE_PER_LEVEL;
}

export function storageGridSize(level: number) {
  const cells = storageCapacity(level);
  const cols = 10;
  const rows = Math.max(2, Math.ceil(cells / cols));
  return { cols, rows, cells };
}

export function loadInv(characterId: string): InstanceRow[] {
  return db
    .prepare("SELECT * FROM item_instances WHERE owner_character_id = ? AND location = 'INVENTORY' AND destroyed_at IS NULL")
    .all(characterId) as InstanceRow[];
}

export function loadEquip(characterId: string): InstanceRow[] {
  return db
    .prepare("SELECT * FROM item_instances WHERE owner_character_id = ? AND location = 'EQUIPMENT' AND destroyed_at IS NULL")
    .all(characterId) as InstanceRow[];
}

export function loadStorage(userId: string): InstanceRow[] {
  return db
    .prepare("SELECT * FROM item_instances WHERE owner_user_id = ? AND location = 'STORAGE' AND destroyed_at IS NULL")
    .all(userId) as InstanceRow[];
}

export function occupyCount(items: InstanceRow[]) {
  return items.reduce((n, it) => {
    const { w, h } = dims(it);
    return n + w * h;
  }, 0);
}
