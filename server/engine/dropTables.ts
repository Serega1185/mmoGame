import { db } from "../db.ts";
import { RARITIES, RARITY_WEIGHTS, type Rarity } from "./stats.ts";

export const DROP_KINDS = ["normal", "elite", "boss"] as const;
export type DropKind = (typeof DROP_KINDS)[number];
export type RarityWeights = Record<Rarity, number>;
export type LevelRange = { min: number; max: number };
export type DropBand = {
  minDepth: number;
  beforeCity: LevelRange;
  afterCity: LevelRange;
};
export type DropConfig = {
  tables: Record<DropKind, RarityWeights>;
  bands: DropBand[];
};

/** Centered city on floor 5. Floors 1–4 are before, 6–10 after. */
export const CITY_FLOOR = 5;

const KEY = "loot_rarity";

function cloneWeights(src: Partial<RarityWeights> | undefined, luck = 0): RarityWeights {
  const boost = 1 + luck / 100;
  const out = {} as RarityWeights;
  for (const r of RARITIES) {
    const base = Number(src?.[r] ?? RARITY_WEIGHTS[r]);
    const n = Number.isFinite(base) && base >= 0 ? base : 0;
    const idx = RARITIES.indexOf(r);
    out[r] = Math.round((idx >= 2 ? n * boost : n) * 1000) / 1000;
  }
  return out;
}

export function defaultLevelRanges(minDepth: number): { beforeCity: LevelRange; afterCity: LevelRange } {
  const d = Math.max(1, Math.trunc(Number(minDepth) || 1));
  return {
    beforeCity: { min: d, max: d + 2 },
    afterCity: { min: d + 1, max: d + 4 },
  };
}

function clampRange(raw: Partial<LevelRange> | undefined, fallback: LevelRange): LevelRange {
  let min = Math.max(1, Math.trunc(Number(raw?.min)));
  let max = Math.max(1, Math.trunc(Number(raw?.max)));
  if (!Number.isFinite(min)) min = fallback.min;
  if (!Number.isFinite(max)) max = fallback.max;
  if (max < min) max = min;
  return { min, max };
}

function emptyTables(): Record<DropKind, RarityWeights> {
  return {
    normal: cloneWeights(RARITY_WEIGHTS, 0),
    elite: cloneWeights(RARITY_WEIGHTS, 10),
    boss: cloneWeights(RARITY_WEIGHTS, 25),
  };
}

export function defaultDropConfig(): DropConfig {
  const levels = defaultLevelRanges(1);
  return {
    tables: emptyTables(),
    bands: [{ minDepth: 1, beforeCity: levels.beforeCity, afterCity: levels.afterCity }],
  };
}

export function emptyWeights(): RarityWeights {
  return cloneWeights(RARITY_WEIGHTS, 0);
}

function tablesFrom(raw: unknown): Record<DropKind, RarityWeights> {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const tables = {} as Record<DropKind, RarityWeights>;
  for (const kind of DROP_KINDS) {
    tables[kind] = cloneWeights(src[kind] as Partial<RarityWeights> | undefined, 0);
    if (!Object.values(tables[kind]).some((v) => v > 0)) tables[kind] = emptyWeights();
  }
  return tables;
}

function normalizeBand(raw: unknown): DropBand | null {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const minDepth = Math.max(1, Math.trunc(Number(src.minDepth)));
  if (!Number.isFinite(minDepth)) return null;
  const fallback = defaultLevelRanges(minDepth);
  return {
    minDepth,
    beforeCity: clampRange(src.beforeCity as LevelRange | undefined, fallback.beforeCity),
    afterCity: clampRange(src.afterCity as LevelRange | undefined, fallback.afterCity),
  };
}

export function normalizeDropConfig(raw: unknown): DropConfig {
  const fallback = defaultDropConfig();
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawBands = Array.isArray(src.bands) ? src.bands : [];
  const legacy = rawBands
    .slice()
    .sort(
      (a: { minDepth?: unknown }, b: { minDepth?: unknown }) =>
        Math.trunc(Number(a?.minDepth) || 1) - Math.trunc(Number(b?.minDepth) || 1)
    )[0] as { tables?: unknown } | undefined;
  const tablesRaw = src.tables ?? legacy?.tables;

  const seen = new Set<number>();
  const bands: DropBand[] = [];
  for (const b of rawBands) {
    const band = normalizeBand(b);
    if (!band || seen.has(band.minDepth)) continue;
    seen.add(band.minDepth);
    bands.push(band);
  }
  if (!bands.length && (src.beforeCity || src.afterCity)) {
    const band = normalizeBand({ minDepth: 1, beforeCity: src.beforeCity, afterCity: src.afterCity });
    if (band) bands.push(band);
  }
  if (!bands.length) return { tables: tablesFrom(tablesRaw), bands: fallback.bands };

  bands.sort((a, c) => a.minDepth - c.minDepth);
  if (bands[0]!.minDepth !== 1) bands[0]!.minDepth = 1;
  return { tables: tablesFrom(tablesRaw), bands };
}

export function loadDropConfig(): DropConfig {
  const row = db.prepare("SELECT value FROM world_settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  if (!row?.value) return defaultDropConfig();
  try {
    return normalizeDropConfig(JSON.parse(row.value));
  } catch {
    return defaultDropConfig();
  }
}

export function saveDropConfig(raw: unknown): DropConfig {
  const cfg = normalizeDropConfig(raw);
  db.prepare(
    `INSERT INTO world_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(KEY, JSON.stringify(cfg));
  return cfg;
}

export function dropKindOf(enemyKind: string): DropKind {
  if (enemyKind === "elite" || enemyKind === "boss") return enemyKind;
  return "normal";
}

export function bandFor(depth: number, cfg = loadDropConfig()): DropBand {
  const d = Math.max(1, Math.trunc(Number(depth) || 1));
  let pick = cfg.bands[0]!;
  for (const b of cfg.bands) {
    if (b.minDepth <= d) pick = b;
    else break;
  }
  return pick;
}

export function weightsFor(_depth: number, kind: DropKind, cfg = loadDropConfig()): RarityWeights {
  return cfg.tables[kind];
}

export function afterCityFloor(round: number) {
  return Math.max(1, Math.trunc(Number(round) || 1)) > CITY_FLOOR;
}

export function levelRangeFor(depth: number, afterCity: boolean, cfg = loadDropConfig()): LevelRange {
  const band = bandFor(depth, cfg);
  return afterCity ? band.afterCity : band.beforeCity;
}

export function chancePercents(weights: RarityWeights): Record<Rarity, number> {
  const total = RARITIES.reduce((s, r) => s + (weights[r] || 0), 0);
  const out = {} as Record<Rarity, number>;
  for (const r of RARITIES) out[r] = total > 0 ? (100 * (weights[r] || 0)) / total : 0;
  return out;
}

export function withLuck(weights: RarityWeights, luck: number): RarityWeights {
  const boost = 1 + Math.max(0, Number(luck) || 0) / 100;
  const out = {} as RarityWeights;
  for (const r of RARITIES) {
    const n = Number(weights[r]) || 0;
    const idx = RARITIES.indexOf(r);
    out[r] = idx >= 2 ? n * boost : n;
  }
  return out;
}
