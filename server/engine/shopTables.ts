import { db } from "../db.ts";
import { RARITIES, RARITY_WEIGHTS, type Rarity } from "./stats.ts";
import { emptyWeights } from "./dropTables.ts";

export type RarityWeights = Record<Rarity, number>;
export type ShopBand = { minDepth: number; weights: RarityWeights };
export type ShopConfig = { bands: ShopBand[]; restockMinutes: number };

export const DEFAULT_SHOP_RESTOCK_MINUTES = 30;

function clampRestockMinutes(n: unknown) {
  const m = Math.trunc(Number(n));
  if (!Number.isFinite(m)) return DEFAULT_SHOP_RESTOCK_MINUTES;
  return Math.max(1, Math.min(24 * 60, m));
}

const KEY = "shop_rarity";

function cloneWeights(src?: Partial<RarityWeights>): RarityWeights {
  const out = {} as RarityWeights;
  for (const r of RARITIES) {
    const n = Number(src?.[r] ?? RARITY_WEIGHTS[r]);
    out[r] = Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : 0;
  }
  return out;
}

export function defaultShopConfig(): ShopConfig {
  return {
    restockMinutes: DEFAULT_SHOP_RESTOCK_MINUTES,
    bands: [
      {
        minDepth: 1,
        weights: cloneWeights({
          Common: 48,
          Uncommon: 28,
          Rare: 16,
          Epic: 8,
          Legendary: 0,
          Mythic: 0,
        }),
      },
    ],
  };
}

export function normalizeShopConfig(raw: unknown): ShopConfig {
  const fallback = defaultShopConfig();
  const bandsIn = Array.isArray((raw as ShopConfig)?.bands) ? (raw as ShopConfig).bands : fallback.bands;
  const seen = new Set<number>();
  const bands: ShopBand[] = [];
  for (const b of bandsIn) {
    const minDepth = Math.max(1, Math.trunc(Number(b?.minDepth)));
    if (!Number.isFinite(minDepth) || seen.has(minDepth)) continue;
    seen.add(minDepth);
    const weights = cloneWeights(b?.weights);
    if (!Object.values(weights).some((v) => v > 0)) bands.push({ minDepth, weights: emptyWeights() });
    else bands.push({ minDepth, weights });
  }
  if (!bands.length) return fallback;
  bands.sort((a, c) => a.minDepth - c.minDepth);
  if (bands[0]!.minDepth !== 1) bands[0]!.minDepth = 1;
  return { bands, restockMinutes: clampRestockMinutes((raw as ShopConfig)?.restockMinutes ?? fallback.restockMinutes) };
}

export function loadShopConfig(): ShopConfig {
  const row = db.prepare("SELECT value FROM world_settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  if (!row?.value) return defaultShopConfig();
  try {
    return normalizeShopConfig(JSON.parse(row.value));
  } catch {
    return defaultShopConfig();
  }
}

export function saveShopConfig(raw: unknown): ShopConfig {
  const cfg = normalizeShopConfig(raw);
  db.prepare(
    `INSERT INTO world_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(KEY, JSON.stringify(cfg));
  return cfg;
}

export function shopRestockMs(cfg = loadShopConfig()) {
  return clampRestockMinutes(cfg.restockMinutes) * 60 * 1000;
}

export function shopWeightsFor(depth: number, cfg = loadShopConfig()): RarityWeights {
  const d = Math.max(1, Math.trunc(Number(depth) || 1));
  let pick = cfg.bands[0]!;
  for (const b of cfg.bands) {
    if (b.minDepth <= d) pick = b;
    else break;
  }
  return pick.weights;
}
