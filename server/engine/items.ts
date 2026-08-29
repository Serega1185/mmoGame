import { v4 as uuid } from "uuid";
import { db, now } from "../db.ts";
import { CONFIG } from "../config.ts";
import {
  RARITIES,
  RARITY_MULT,
  RARITY_WEIGHTS,
  exclusiveDamage,
  hashUnit,
  pickStatsForRarity,
  rollDefinitionStats,
  sanitizeStats,
  schoolFromTags,
  statRangeFor,
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
  const base = sanitizeStats(JSON.parse(def.base_stats) as Stats);
  const id = uuid();
  let ri = 0;
  const stats = rollDefinitionStats(base, rarity, magic, () => hashUnit(id, ri++));
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

export function itemValue(inst: InstanceRow): number {
  const stats = JSON.parse(inst.stats) as Stats;
  const sum = Object.values(stats).reduce((a, b) => a + Math.abs(b || 0), 0);
  const r = RARITY_MULT[inst.rarity as Rarity] || 1;
  return Math.max(4, Math.round(sum * 2.2 * r));
}

export function instanceStatRanges(base: Stats, rarity: Rarity, magic: boolean) {
  const clean = pickStatsForRarity(exclusiveDamage(sanitizeStats(base as Record<string, number>), magic), rarity);
  const ranges: Record<string, { min: number; max: number }> = {};
  for (const [k, b] of Object.entries(clean)) {
    if (!b) continue;
    ranges[k] = statRangeFor(k as StatKey, b, rarity);
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
  const base = sanitizeStats(JSON.parse(def.base_stats) as Stats);
  let i = 0;
  const stats = rollDefinitionStats(base, inst.rarity as Rarity, magic, () => hashUnit(inst.id, i++));
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
  const base = def ? sanitizeStats(JSON.parse(String(def.base_stats)) as Stats) : {};
  const rarity = inst.rarity as Rarity;
  const stats = pickStatsForRarity(
    exclusiveDamage(sanitizeStats(JSON.parse(inst.stats) as Stats), magic),
    rarity
  );
  return {
    ...inst,
    stats,
    affixes: [],
    statRanges: instanceStatRanges(base, rarity, magic),
    magicSchool: schoolFromTags(tags),
    definition: {
      ...def,
      base_stats: base,
      tags,
    },
    set: setRow || null,
    value: itemValue(inst),
  };
}
