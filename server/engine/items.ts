import { v4 as uuid } from "uuid";
import { db, now } from "../db.ts";
import { CONFIG } from "../config.ts";
import {
  RARITIES,
  RARITY_MULT,
  RARITY_WEIGHTS,
  exclusiveDamage,
  hashUnit,
  isRarityStatMap,
  pickStatsForRarity,
  resolveRarityStats,
  rollDefinitionStats,
  sanitizeStats,
  schoolFromTags,
  statRangeFor,
  statSpread,
  type Rarity,
  type StatKey,
  type Stats,
} from "../engine/stats.ts";

export function rollRarity(luck = 0, min?: string, table?: Record<string, number>): Rarity {
  const boost = 1 + luck / 100;
  const weights = RARITIES.map((r) => {
    const base = Number(table?.[r] ?? RARITY_WEIGHTS[r]);
    const n = Number.isFinite(base) && base > 0 ? base : 0;
    const idx = RARITIES.indexOf(r);
    return idx >= 2 ? n * boost : n;
  });
  const minIdx = min ? RARITIES.indexOf(min as Rarity) : 0;
  let total = 0;
  for (let i = minIdx; i < weights.length; i++) total += weights[i]!;
  let roll = Math.random() * total;
  for (let i = minIdx; i < RARITIES.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return RARITIES[i]!;
  }
  return RARITIES[Math.max(minIdx, 0)]!;
}

export type InstanceRow = {
  id: string;
  definition_id: string;
  owner_user_id: string;
  owner_character_id: string | null;
  location: string;
  rarity: string;
  item_level: number;
  required_level: number;
  stats: string;
  affixes: string;
  width: number;
  height: number;
  rotated: number;
  stack: number;
  grid_x: number | null;
  grid_y: number | null;
  equip_slot: string | null;
  created_at: number;
  destroyed_at: number | null;
};

export function generateInstance(opts: {
  definitionId: string;
  ownerUserId: string;
  ownerCharacterId?: string | null;
  location: string;
  region?: number;
  luck?: number;
  forceRarity?: Rarity;
  rarityWeights?: Record<string, number>;
}): InstanceRow {
  const def = db.prepare("SELECT * FROM item_definitions WHERE id = ?").get(opts.definitionId) as {
    id: string;
    rarity_min: string;
    base_level: number;
    required_level: number;
    width: number;
    height: number;
    base_stats: string;
    affix_pool: string;
    tags: string;
  };
  if (!def) throw new Error("Unknown item definition");
  const rarity = opts.forceRarity || rollRarity(opts.luck || 0, def.rarity_min, opts.rarityWeights);
  const required = CONFIG.ITEM_REQUIRED_LEVEL ? Math.max(1, def.required_level) : 1;
  const tags = JSON.parse(def.tags || "[]") as string[];
  const magic = tags.includes("magic");
  const rawStats = JSON.parse(def.base_stats || "{}");
  const id = uuid();
  let ri = 0;
  const stats = resolveRarityStats(rawStats, rarity, (base, alreadyScaled) =>
    rollDefinitionStats(base, rarity, magic, () => hashUnit(id, ri++), alreadyScaled)
  );
  const affixes: { key: string; value: number }[] = [];
  const row: InstanceRow = {
    id,
    definition_id: def.id,
    owner_user_id: opts.ownerUserId,
    owner_character_id: opts.ownerCharacterId ?? null,
    location: opts.location,
    rarity,
    item_level: 1,
    required_level: required,
    stats: JSON.stringify(stats),
    affixes: JSON.stringify(affixes),
    width: 1,
    height: 1,
    rotated: 0,
    stack: 1,
    grid_x: null,
    grid_y: null,
    equip_slot: null,
    created_at: now(),
    destroyed_at: null,
  };
  db.prepare(
    `INSERT INTO item_instances (id, definition_id, owner_user_id, owner_character_id, location, rarity, item_level, required_level, stats, affixes, width, height, rotated, stack, grid_x, grid_y, equip_slot, created_at)
     VALUES (@id,@definition_id,@owner_user_id,@owner_character_id,@location,@rarity,@item_level,@required_level,@stats,@affixes,@width,@height,@rotated,@stack,@grid_x,@grid_y,@equip_slot,@created_at)`
  ).run(row);
  return row;
}

export function destroyInstance(id: string) {
  db.prepare(
    "UPDATE item_instances SET location = 'DESTROYED', destroyed_at = ?, owner_character_id = NULL, grid_x = NULL, grid_y = NULL, equip_slot = NULL WHERE id = ?"
  ).run(now(), id);
}

export function parseValueByRarity(raw: unknown, fallback = 0): Record<Rarity, number> {
  let src: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") src = parsed as Record<string, unknown>;
    } catch {
      src = {};
    }
  } else if (raw && typeof raw === "object") {
    src = raw as Record<string, unknown>;
  }
  const out = {} as Record<Rarity, number>;
  for (const r of RARITIES) {
    const n = Math.max(0, Math.trunc(Number(src[r])));
    out[r] = Number.isFinite(n) ? n : fallback;
  }
  return out;
}

function defValue(definitionId: string, rarity: Rarity, stats: Stats) {
  const def = db.prepare("SELECT base_value, value_by_rarity FROM item_definitions WHERE id=?").get(definitionId) as
    | { base_value: number; value_by_rarity: string }
    | undefined;
  const r = RARITY_MULT[rarity] || 1;
  const sum = Object.values(stats).reduce((a, b) => a + Math.abs(b || 0), 0);
  const auto = Math.max(4, Math.round(sum * 2.2 * r));
  const byRarity = parseValueByRarity(def?.value_by_rarity);
  const anyPriced = RARITIES.some((k) => (byRarity[k] || 0) > 0);
  if (anyPriced) {
    const priced = byRarity[rarity] || 0;
    return priced > 0 ? Math.max(1, priced) : auto;
  }
  const legacy = Math.max(0, Math.trunc(Number(def?.base_value) || 0));
  if (legacy > 0) return Math.max(1, legacy);
  return auto;
}

const SELL_PCT_KEY = "sell_pct";

export function loadSellPct(): number {
  const row = db.prepare("SELECT value FROM world_settings WHERE key = ?").get(SELL_PCT_KEY) as { value: string } | undefined;
  const n = Math.trunc(Number(row?.value));
  if (!Number.isFinite(n) || n < 0) return 100;
  return Math.min(1000, n);
}

export function saveSellPct(raw: unknown): number {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>).pct : raw;
  const n = Math.trunc(Number(src));
  const pct = !Number.isFinite(n) || n < 0 ? 100 : Math.min(1000, n);
  db.prepare(
    `INSERT INTO world_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(SELL_PCT_KEY, String(pct));
  return pct;
}

export function itemValue(inst: InstanceRow): number {
  return defValue(inst.definition_id, inst.rarity as Rarity, JSON.parse(inst.stats) as Stats);
}

export function itemSellGross(inst: InstanceRow): number {
  return Math.max(0, Math.round((itemValue(inst) * loadSellPct()) / 100));
}

export function instanceStatRanges(base: Stats, rarity: Rarity, magic: boolean, alreadyScaled = false) {
  const clean = pickStatsForRarity(exclusiveDamage(sanitizeStats(base as Record<string, number>), magic), rarity);
  const ranges: Record<string, { min: number; max: number }> = {};
  for (const [k, b] of Object.entries(clean)) {
    if (!b) continue;
    ranges[k] = alreadyScaled ? statSpread(k as StatKey, b) : statRangeFor(k as StatKey, b, rarity);
  }
  return ranges;
}

export function rerollInstanceFromDefinition(inst: InstanceRow) {
  const def = db.prepare("SELECT base_stats, tags FROM item_definitions WHERE id = ?").get(inst.definition_id) as
    | { base_stats: string; tags: string }
    | undefined;
  if (!def) return inst;
  const tags = JSON.parse(def.tags || "[]") as string[];
  const magic = tags.includes("magic");
  const rawStats = JSON.parse(def.base_stats || "{}");
  let i = 0;
  const stats = resolveRarityStats(rawStats, inst.rarity as Rarity, (base, alreadyScaled) =>
    rollDefinitionStats(base, inst.rarity as Rarity, magic, () => hashUnit(inst.id, i++), alreadyScaled)
  );
  inst.stats = JSON.stringify(stats);
  inst.affixes = "[]";
  db.prepare("UPDATE item_instances SET stats = ?, affixes = ?, item_level = 1 WHERE id = ?").run(inst.stats, inst.affixes, inst.id);
  inst.item_level = 1;
  return inst;
}

export function hydrate(inst: InstanceRow) {
  const def = db.prepare("SELECT * FROM item_definitions WHERE id = ?").get(inst.definition_id) as Record<string, unknown>;
  const setRow = def?.set_id
    ? (db.prepare("SELECT * FROM item_sets WHERE id = ?").get(def.set_id as string) as Record<string, unknown> | undefined)
    : null;
  const tags = def ? (JSON.parse(String(def.tags)) as string[]) : [];
  const magic = tags.includes("magic");
  const rawBase = def ? JSON.parse(String(def.base_stats || "{}")) : {};
  const scaled = isRarityStatMap(rawBase);
  const base = scaled
    ? sanitizeStats((rawBase[inst.rarity] || rawBase.Common || {}) as Stats)
    : sanitizeStats(rawBase as Stats);
  const rarity = inst.rarity as Rarity;
  const stats = pickStatsForRarity(
    exclusiveDamage(sanitizeStats(JSON.parse(inst.stats) as Stats), magic),
    rarity
  );
  return {
    ...inst,
    stats,
    affixes: [],
    statRanges: instanceStatRanges(base, rarity, magic, scaled),
    magicSchool: schoolFromTags(tags),
    definition: {
      ...def,
      icon: String(def?.icon || ""),
      base_stats: base,
      tags,
    },
    set: setRow || null,
    value: itemSellGross(inst),
  };
}
