import { db } from "../db.ts";
import { CONFIG } from "../config.ts";
import type { InstanceRow } from "./items.ts";

export type Grid = (string | null)[][];

export function emptyGrid(cols = CONFIG.GRID_COLS, rows = CONFIG.GRID_ROWS): Grid {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
}

export function dims(_item?: { width: number; height: number; rotated: number }) {
  return { w: 1, h: 1 };
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
  const probe = { ...item, width: 1, height: 1, rotated: 0 };
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < (grid[0]?.length ?? 0); x++) {
      if (canPlace(grid, probe, x, y)) return { x, y, rotated: 0 };
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
  return items.length;
}

export function flattenToOneCell() {
  db.prepare("UPDATE item_instances SET width = 1, height = 1, rotated = 0").run();
  db.prepare("UPDATE item_definitions SET width = 1, height = 1").run();
}

export function compactInventory(characterId: string) {
  const items = loadInv(characterId);
  const grid = emptyGrid();
  for (const it of items) {
    const spot = findPlace(grid, it);
    if (!spot) {
      db.prepare("UPDATE item_instances SET grid_x = NULL, grid_y = NULL WHERE id = ?").run(it.id);
      continue;
    }
    db.prepare("UPDATE item_instances SET grid_x=?, grid_y=?, rotated=0, width=1, height=1 WHERE id=?").run(
      spot.x,
      spot.y,
      it.id
    );
    grid[spot.y]![spot.x] = it.id;
  }
}

export function fillMissingSlots(characterId: string) {
  const items = loadInv(characterId);
  const cols = CONFIG.GRID_COLS;
  const rows = CONFIG.GRID_ROWS;
  const oob = items.some(
    (i) => i.grid_x != null && i.grid_y != null && (i.grid_x < 0 || i.grid_y < 0 || i.grid_x >= cols || i.grid_y >= rows)
  );
  if (oob) {
    compactInventory(characterId);
    return;
  }
  const placed = items.filter((i) => i.grid_x != null && i.grid_y != null);
  const missing = items.filter((i) => i.grid_x == null || i.grid_y == null);
  if (!missing.length) return;
  const grid = buildGrid(placed);
  for (const it of missing) {
    const spot = findPlace(grid, it);
    if (!spot) continue;
    db.prepare("UPDATE item_instances SET grid_x=?, grid_y=?, rotated=0, width=1, height=1 WHERE id=?").run(
      spot.x,
      spot.y,
      it.id
    );
    grid[spot.y]![spot.x] = it.id;
  }
}

export function reflowInventories() {
  const rows = db
    .prepare(
      `SELECT DISTINCT owner_character_id AS id FROM item_instances WHERE location = 'INVENTORY' AND destroyed_at IS NULL AND owner_character_id IS NOT NULL`
    )
    .all() as { id: string }[];
  for (const r of rows) fillMissingSlots(r.id);
}
