import { db, now } from "../db.ts";

const KEY = "map_globals";

export type MapGlobals = {
  refreshMinutes: number;
  eliteMin: number;
  eliteMax: number;
  mysteryMin: number;
  mysteryMax: number;
  campMin: number;
  campMax: number;
  campCoins: number;
  campDepthMul: number;
};

function readInt(raw: unknown): number | null {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) ? n : null;
}

function clampRange(
  minRaw: unknown,
  maxRaw: unknown,
  legacy: unknown,
  lo: number,
  hi: number,
  fallbackMin: number,
  fallbackMax: number
) {
  let min = readInt(minRaw) ?? readInt(legacy) ?? fallbackMin;
  let max = readInt(maxRaw) ?? readInt(legacy) ?? fallbackMax;
  min = Math.min(hi, Math.max(lo, min));
  max = Math.min(hi, Math.max(lo, max));
  if (max < min) max = min;
  return { min, max };
}

export function defaultMapGlobals(): MapGlobals {
  return {
    refreshMinutes: 60,
    eliteMin: 1,
    eliteMax: 2,
    mysteryMin: 1,
    mysteryMax: 2,
    campMin: 1,
    campMax: 2,
    campCoins: 30,
    campDepthMul: 0.5,
  };
}

export function normalizeMapGlobals(raw: unknown): MapGlobals {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawR = Math.trunc(Number(src.refreshMinutes));
  const elite = clampRange(src.eliteMin, src.eliteMax, src.eliteCount, 1, 4, 1, 2);
  const mystery = clampRange(src.mysteryMin, src.mysteryMax, src.mysteryCount, 0, 8, 1, 2);
  const camp = clampRange(src.campMin, src.campMax, src.campCount, 1, 2, 1, 2);
  const coins = Math.trunc(Number(src.campCoins));
  const mul = Number(src.campDepthMul);
  return {
    refreshMinutes: Number.isFinite(rawR) && rawR >= 1 ? Math.min(10080, rawR) : 60,
    eliteMin: elite.min,
    eliteMax: elite.max,
    mysteryMin: mystery.min,
    mysteryMax: mystery.max,
    campMin: camp.min,
    campMax: camp.max,
    campCoins: Number.isFinite(coins) && coins >= 0 ? Math.min(1_000_000, coins) : 30,
    campDepthMul: Number.isFinite(mul) && mul >= 0 ? Math.min(100, mul) : 0.5,
  };
}

export function campCoinPayout(depth: number, cfg = loadMapGlobals()) {
  const d = Math.max(1, Math.trunc(Number(depth) || 1));
  return Math.max(0, Math.round(cfg.campCoins * (d * cfg.campDepthMul)));
}

export function rollCount(min: number, max: number) {
  const a = Math.max(0, Math.trunc(min));
  const b = Math.max(a, Math.trunc(max));
  if (b <= a) return a;
  return a + Math.floor(Math.random() * (b - a + 1));
}

export function loadMapGlobals(): MapGlobals {
  const row = db.prepare("SELECT value FROM world_settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  if (!row?.value) return defaultMapGlobals();
  try {
    return normalizeMapGlobals(JSON.parse(row.value));
  } catch {
    return defaultMapGlobals();
  }
}

export function saveMapGlobals(raw: unknown): MapGlobals {
  const cfg = normalizeMapGlobals(raw);
  db.prepare(
    `INSERT INTO world_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(KEY, JSON.stringify(cfg));
  return cfg;
}

export function mapRefreshMs(cfg = loadMapGlobals()) {
  return Math.max(1, cfg.refreshMinutes) * 60_000;
}

export type ParkedMap = {
  depth: number;
  map_state: string;
  refresh_at: number | null;
};

export function parkedMap(characterId: string, depth: number): ParkedMap | null {
  const row = db
    .prepare("SELECT depth, map_state, refresh_at FROM character_maps WHERE character_id=? AND depth=?")
    .get(characterId, depth) as ParkedMap | undefined;
  return row || null;
}

export function parkedMapsFor(characterId: string): ParkedMap[] {
  return db
    .prepare("SELECT depth, map_state, refresh_at FROM character_maps WHERE character_id=?")
    .all(characterId) as ParkedMap[];
}

export function upsertParkedMap(
  characterId: string,
  depth: number,
  mapState: string,
  refreshAt: number | null | undefined
) {
  const d = Math.max(1, Math.trunc(depth));
  const prev = parkedMap(characterId, d);
  const nextRefresh = refreshAt === undefined ? prev?.refresh_at ?? null : refreshAt;
  db.prepare(
    `INSERT INTO character_maps (character_id, depth, map_state, refresh_at) VALUES (?,?,?,?)
     ON CONFLICT(character_id, depth) DO UPDATE SET
       map_state=excluded.map_state,
       refresh_at=excluded.refresh_at`
  ).run(characterId, d, mapState, nextRefresh);
}

export function roadIsOpen(characterId: string, depth: number) {
  const row = parkedMap(characterId, depth);
  if (!row?.refresh_at) return true;
  return now() >= row.refresh_at;
}

export function ensureMapTables() {
  db.exec(
    `CREATE TABLE IF NOT EXISTS character_maps (
      character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      depth INTEGER NOT NULL,
      map_state TEXT NOT NULL,
      refresh_at INTEGER,
      PRIMARY KEY (character_id, depth)
    )`
  );
}
