import { db } from "../db.ts";

export const ORE_IDS = ["copper", "iron", "gold", "mithril", "adamantite", "titanium"] as const;
export type OreId = (typeof ORE_IDS)[number];

export const ORE_META: Record<OreId, { defId: string; rarity: string }> = {
  copper: { defId: "ore_copper", rarity: "Common" },
  iron: { defId: "ore_iron", rarity: "Uncommon" },
  gold: { defId: "ore_gold", rarity: "Rare" },
  mithril: { defId: "ore_mithril", rarity: "Epic" },
  adamantite: { defId: "ore_adamantite", rarity: "Legendary" },
  titanium: { defId: "ore_titanium", rarity: "Mythic" },
};

export type MineWeights = Record<OreId, number>;
export type MineBand = { minDepth: number; minMines: number; maxMines: number; weights: MineWeights };
export type MineConfig = { bands: MineBand[] };

const KEY = "mine_odds";

function emptyWeights(): MineWeights {
  return { copper: 0, iron: 0, gold: 0, mithril: 0, adamantite: 0, titanium: 0 };
}

export function defaultMineConfig(): MineConfig {
  return {
    bands: [
      {
        minDepth: 1,
        minMines: 1,
        maxMines: 2,
        weights: { copper: 50, iron: 28, gold: 14, mithril: 6, adamantite: 1.5, titanium: 0.5 },
      },
    ],
  };
}

export function normalizeMineConfig(raw: unknown): MineConfig {
  const fallback = defaultMineConfig();
  const bandsIn = Array.isArray((raw as MineConfig)?.bands) ? (raw as MineConfig).bands : fallback.bands;
  const seen = new Set<number>();
  const bands: MineBand[] = [];
  for (const b of bandsIn) {
    const minDepth = Math.max(1, Math.trunc(Number(b?.minDepth)));
    if (!Number.isFinite(minDepth) || seen.has(minDepth)) continue;
    seen.add(minDepth);
    let minMines = Math.max(0, Math.trunc(Number(b?.minMines)));
    let maxMines = Math.max(0, Math.trunc(Number(b?.maxMines)));
    if (!Number.isFinite(minMines)) minMines = 0;
    if (!Number.isFinite(maxMines)) maxMines = minMines;
    if (maxMines < minMines) maxMines = minMines;
    maxMines = Math.min(12, maxMines);
    minMines = Math.min(maxMines, minMines);
    const weights = emptyWeights();
    for (const id of ORE_IDS) {
      const n = Number((b?.weights as MineWeights)?.[id]);
      weights[id] = Number.isFinite(n) && n >= 0 ? n : 0;
    }
    if (!ORE_IDS.some((id) => weights[id] > 0)) weights.copper = 50;
    bands.push({ minDepth, minMines, maxMines, weights });
  }
  if (!bands.length) return fallback;
  bands.sort((a, c) => a.minDepth - c.minDepth);
  if (bands[0]!.minDepth !== 1) bands[0]!.minDepth = 1;
  return { bands };
}

export function loadMineConfig(): MineConfig {
  const row = db.prepare("SELECT value FROM world_settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  if (!row?.value) return defaultMineConfig();
  try {
    return normalizeMineConfig(JSON.parse(row.value));
  } catch {
    return defaultMineConfig();
  }
}

export function saveMineConfig(raw: unknown): MineConfig {
  const cfg = normalizeMineConfig(raw);
  db.prepare(
    `INSERT INTO world_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(KEY, JSON.stringify(cfg));
  return cfg;
}

export function mineBandFor(depth: number, cfg = loadMineConfig()): MineBand {
  const d = Math.max(1, Math.trunc(Number(depth) || 1));
  let pick = cfg.bands[0]!;
  for (const b of cfg.bands) {
    if (b.minDepth <= d) pick = b;
    else break;
  }
  return pick;
}

export function rollOre(weights: MineWeights): OreId {
  const total = ORE_IDS.reduce((s, id) => s + (weights[id] || 0), 0);
  if (total <= 0) return "copper";
  let r = Math.random() * total;
  for (const id of ORE_IDS) {
    r -= weights[id] || 0;
    if (r <= 0) return id;
  }
  return "copper";
}

export function oreIdForRarity(rarity: string): OreId | null {
  const hit = ORE_IDS.find((id) => ORE_META[id].rarity === rarity);
  return hit || null;
}
