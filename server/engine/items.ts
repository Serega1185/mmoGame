import { v4 as uuid } from "uuid";
import { db, now } from "../db.ts";
import { CONFIG } from "../config.ts";
import {
  RARITIES,
  RARITY_AFFIXES,
  RARITY_MULT,
  RARITY_WEIGHTS,
  type Rarity,
  type Stats,
  scaleStats,
} from "../engine/stats.ts";

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}
function irand(min: number, max: number) {
  return Math.floor(rand(min, max + 1));
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function rollRarity(luck = 0, min?: string): Rarity {
  const boost = 1 + luck / 100;
  const weights = RARITIES.map((r) => {
    const base = RARITY_WEIGHTS[r];
    const idx = RARITIES.indexOf(r);
    return idx >= 2 ? base * boost : base;
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
  };
  if (!def) throw new Error("Unknown item definition");
  const rarity = opts.forceRarity || rollRarity(opts.luck || 0, def.rarity_min);
  const region = opts.region || 1;
  const itemLevel = Math.max(def.base_level, region * 3 + irand(-1, 2));
  const required = CONFIG.ITEM_REQUIRED_LEVEL
    ? Math.max(1, def.required_level + Math.max(0, Math.floor((itemLevel - def.base_level) / 4)))
    : 1;
  const base = JSON.parse(def.base_stats) as Stats;
  const pool = JSON.parse(def.affix_pool) as { key: keyof Stats; min: number; max: number }[];
  const [amin, amax] = RARITY_AFFIXES[rarity];
  const nAff = irand(amin, amax);
  const affixes: { key: string; value: number }[] = [];
  const used = new Set<string>();
  const stats: Stats = scaleStats(base, RARITY_MULT[rarity] * (1 + itemLevel * 0.03));
  if (pool.length) {
    for (let i = 0; i < nAff; i++) {
      const p = pick(pool.filter((x) => !used.has(String(x.key))) || pool);
      if (!p) break;
      used.add(String(p.key));
      const value = Math.round(rand(p.min, p.max) * RARITY_MULT[rarity] * 10) / 10;
      affixes.push({ key: String(p.key), value });
      stats[p.key] = (stats[p.key] || 0) + value;
    }
  }
  const row: InstanceRow = {
    id: uuid(),
    definition_id: def.id,
    owner_user_id: opts.ownerUserId,
    owner_character_id: opts.ownerCharacterId ?? null,
    location: opts.location,
    rarity,
    item_level: itemLevel,
    required_level: required,
    stats: JSON.stringify(stats),
    affixes: JSON.stringify(affixes),
    width: def.width,
    height: def.height,
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
  return Math.max(4, Math.round(sum * 2.2 * r + inst.item_level * 3));
}

export function hydrate(inst: InstanceRow) {
  const def = db.prepare("SELECT * FROM item_definitions WHERE id = ?").get(inst.definition_id) as Record<string, unknown>;
  const setRow = def?.set_id
    ? (db.prepare("SELECT * FROM item_sets WHERE id = ?").get(def.set_id as string) as Record<string, unknown> | undefined)
    : null;
  return {
    ...inst,
    stats: JSON.parse(inst.stats),
    affixes: JSON.parse(inst.affixes),
    definition: {
      ...def,
      base_stats: def ? JSON.parse(String(def.base_stats)) : {},
      tags: def ? JSON.parse(String(def.tags)) : [],
    },
    set: setRow || null,
    value: itemValue(inst),
  };
}
