import { db } from "../db.ts";
import { RARITIES, RARITY_WEIGHTS, type Rarity } from "./stats.ts";

export const DROP_KINDS = ["normal", "elite", "boss"] as const;
export type DropKind = (typeof DROP_KINDS)[number];
export type RarityWeights = Record<Rarity, number>;
export type DropBand = { minDepth: number; tables: Record<DropKind, RarityWeights> };
export type DropConfig = { bands: DropBand[] };

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

export function defaultDropConfig(): DropConfig {
  return {
    bands: [
      {
        minDepth: 0,
        tables: {
          normal: cloneWeights(RARITY_WEIGHTS, 0),
          elite: cloneWeights(RARITY_WEIGHTS, 10),
          boss: cloneWeights(RARITY_WEIGHTS, 25),
        },
      },
    ],
  };
}

export function emptyWeights(): RarityWeights {
  return cloneWeights(RARITY_WEIGHTS, 0);
}

export function normalizeDropConfig(raw: unknown): DropConfig {
  const fallback = defaultDropConfig();
  const bandsIn = Array.isArray((raw as DropConfig)?.bands) ? (raw as DropConfig).bands : fallback.bands;
  const seen = new Set<number>();
  const bands: DropBand[] = [];
  for (const b of bandsIn) {
    const minDepth = Math.max(0, Math.trunc(Number(b?.minDepth)));
    if (!Number.isFinite(minDepth) || seen.has(minDepth)) continue;
    seen.add(minDepth);
    const tables = {} as Record<DropKind, RarityWeights>;
    for (const kind of DROP_KINDS) {
      tables[kind] = cloneWeights(b?.tables?.[kind], 0);
      if (!Object.values(tables[kind]).some((v) => v > 0)) tables[kind] = emptyWeights();
    }
    bands.push({ minDepth, tables });
  }
  if (!bands.length) return fallback;
  bands.sort((a, c) => a.minDepth - c.minDepth);
  if (bands[0]!.minDepth !== 0) bands[0]!.minDepth = 0;
  return { bands };
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

export function weightsFor(depth: number, kind: DropKind, cfg = loadDropConfig()): RarityWeights {
  const d = Math.max(0, Math.trunc(Number(depth) || 0));
  let pick = cfg.bands[0]!;
  for (const b of cfg.bands) {
    if (b.minDepth <= d) pick = b;
    else break;
  }
  return pick.tables[kind];
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
