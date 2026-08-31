export const RARITIES = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"] as const;
export type Rarity = (typeof RARITIES)[number];

export const RARITY_WEIGHTS: Record<Rarity, number> = {
  Common: 54,
  Uncommon: 26,
  Rare: 12,
  Epic: 5.5,
  Legendary: 2,
  Mythic: 0.5,
};

export const RARITY_AFFIXES: Record<Rarity, [number, number]> = {
  Common: [1, 1],
  Uncommon: [2, 2],
  Rare: [3, 3],
  Epic: [4, 4],
  Legendary: [5, 5],
  Mythic: [5, 5],
};

export const STATS_PER_RARITY: Record<Rarity, number> = {
  Common: 1,
  Uncommon: 2,
  Rare: 3,
  Epic: 4,
  Legendary: 5,
  Mythic: 6,
};

export const RARITY_MULT: Record<Rarity, number> = {
  Common: 1,
  Uncommon: 1.15,
  Rare: 1.35,
  Epic: 1.6,
  Legendary: 2,
  Mythic: 2.6,
};

export const STAT_KEYS = [
  "health",
  "damage",
  "magicDamage",
  "armor",
  "dodge",
  "regen",
  "luck",
  "critChance",
  "critDamage",
  "lifesteal",
  "poison",
  "poisonChance",
  "bleed",
  "bleedChance",
  "thorns",
  "barrier",
] as const;

export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Partial<Record<StatKey, number>>;
export type MagicSchool = "chain" | "fire" | "frost";

export const STAT_LABEL: Record<StatKey, string> = {
  health: "Health",
  damage: "Physical Damage",
  magicDamage: "Magic Damage",
  armor: "Armor",
  dodge: "Dodge",
  regen: "Regen",
  luck: "Luck",
  critChance: "Crit Chance",
  critDamage: "Crit Damage",
  lifesteal: "Lifesteal",
  poison: "Poison",
  poisonChance: "Poison Chance",
  bleed: "Bleed",
  bleedChance: "Bleed Chance",
  thorns: "Thorns",
  barrier: "Barrier",
};

export const PERCENT_STATS = new Set<StatKey>([
  "dodge",
  "luck",
  "critChance",
  "critDamage",
  "lifesteal",
  "poisonChance",
  "bleedChance",
]);

export const INT_STATS = new Set<StatKey>([
  "health",
  "damage",
  "magicDamage",
  "armor",
  "regen",
  "poison",
  "bleed",
  "thorns",
  "barrier",
]);

const LEGACY_STAT: Record<string, StatKey> = {
  goldFind: "luck",
  lootChance: "luck",
  mining: "luck",
  fire: "magicDamage",
  armorPen: "damage",
  execute: "critDamage",
  undeadDamage: "damage",
  attackSpeed: "dodge",
};

export function emptyStats(): Record<StatKey, number> {
  const s = {} as Record<StatKey, number>;
  for (const k of STAT_KEYS) s[k] = 0;
  return s;
}

export function addStats(a: Stats, b: Stats): Record<StatKey, number> {
  const out = emptyStats();
  for (const k of STAT_KEYS) out[k] = (a[k] || 0) + (b[k] || 0);
  return out;
}

export function scaleStats(s: Stats, mult: number): Stats {
  const out: Stats = {};
  for (const k of STAT_KEYS) {
    const v = s[k];
    if (v) out[k] = roundStat(k, v * mult);
  }
  return out;
}

export function roundStat(key: StatKey, value: number): number {
  if (INT_STATS.has(key)) return Math.round(value);
  return Math.round(value * 10) / 10;
}

const CHANCE_STATS = new Set<StatKey>(["poisonChance", "bleedChance"]);

export function sanitizeStats(raw: Record<string, number> | Stats | null | undefined): Stats {
  const out: Stats = {};
  if (!raw) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!v) continue;
    const key = (LEGACY_STAT[k] || k) as StatKey;
    if (!STAT_KEYS.includes(key)) continue;
    out[key] = roundStat(key, (out[key] || 0) + Number(v));
  }
  if (out.poison && !out.poisonChance) out.poisonChance = 30;
  if (out.bleed && !out.bleedChance) out.bleedChance = 30;
  return out;
}

export function isRarityStatMap(raw: unknown): raw is Partial<Record<Rarity, Stats>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const rec = raw as Record<string, unknown>;
  return RARITIES.some((r) => rec[r] && typeof rec[r] === "object");
}

export function parseStatsByRarity(raw: unknown): Partial<Record<Rarity, Stats>> | null {
  const parsed = typeof raw === "string" ? safeJson(raw) : raw;
  if (!isRarityStatMap(parsed)) return null;
  const out: Partial<Record<Rarity, Stats>> = {};
  for (const r of RARITIES) {
    if (parsed[r] && typeof parsed[r] === "object") out[r] = sanitizeStats(parsed[r] as Stats);
  }
  return out;
}

export function resolveRarityStats(
  raw: unknown,
  rarity: Rarity,
  fallback: (base: Stats, alreadyScaled?: boolean) => Stats
): Stats {
  const map = parseStatsByRarity(raw);
  if (map) {
    const hit = map[rarity] || map.Common || map[RARITIES.find((r) => map[r])!];
    return fallback(sanitizeStats(hit || {}), true);
  }
  const parsed = typeof raw === "string" ? safeJson(raw) : raw;
  return fallback(sanitizeStats((parsed && typeof parsed === "object" ? parsed : {}) as Stats), false);
}

function safeJson(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function exclusiveDamage(stats: Stats, magic: boolean): Stats {
  const out: Stats = {};
  for (const [k, v] of Object.entries(stats)) {
    if (!v) continue;
    if (magic && k === "damage") continue;
    if (!magic && k === "magicDamage") continue;
    out[k as StatKey] = v;
  }
  return out;
}

export function countableStatKeys(stats: Stats): StatKey[] {
  return (Object.keys(stats) as StatKey[]).filter((k) => STAT_KEYS.includes(k) && !!stats[k] && !CHANCE_STATS.has(k));
}

export function pickStatsForRarity(stats: Stats, rarity: Rarity): Stats {
  const n = STATS_PER_RARITY[rarity] || 1;
  const keep = new Set(countableStatKeys(stats).slice(0, n));
  const out: Stats = {};
  for (const [k, v] of Object.entries(stats)) {
    if (!v) continue;
    const key = k as StatKey;
    if (keep.has(key)) out[key] = v;
    else if (key === "poisonChance" && keep.has("poison")) out[key] = v;
    else if (key === "bleedChance" && keep.has("bleed")) out[key] = v;
  }
  return out;
}

export function padItemStats(stats: Stats, pad: [StatKey, number][]): Stats {
  const out: Stats = { ...stats };
  for (const [k, v] of pad) {
    if (countableStatKeys(out).length >= 6) break;
    if (out[k] || CHANCE_STATS.has(k)) continue;
    if (k === "damage" && out.magicDamage) continue;
    if (k === "magicDamage" && out.damage) continue;
    out[k] = v;
  }
  return out;
}

export function statMid(base: number, rarity: Rarity): number {
  return base * (RARITY_MULT[rarity] || 1);
}

export function statSpread(key: StatKey, mid: number): { min: number; max: number } {
  let min = roundStat(key, mid * 0.9);
  let max = roundStat(key, mid * 1.1);
  if (max < min) max = min;
  return { min, max };
}

export function rollAround(key: StatKey, mid: number, unit = Math.random()): number {
  const { min, max } = statSpread(key, mid);
  const v = roundStat(key, mid * (0.9 + unit * 0.2));
  return Math.min(max, Math.max(min, v));
}

export function rollStatValue(key: StatKey, base: number, rarity: Rarity, unit = Math.random()): number {
  return rollAround(key, statMid(base, rarity), unit);
}

export function statRangeFor(key: StatKey, base: number, rarity: Rarity): { min: number; max: number } {
  return statSpread(key, statMid(base, rarity));
}

export function rollDefinitionStats(
  base: Stats,
  rarity: Rarity,
  magic: boolean,
  roll: () => number = Math.random,
  alreadyScaled = false
): Stats {
  const clean = pickStatsForRarity(exclusiveDamage(sanitizeStats(base as Record<string, number>), magic), rarity);
  const out: Stats = {};
  for (const [k, b] of Object.entries(clean)) {
    if (!b) continue;
    const mid = alreadyScaled ? b : statMid(b, rarity);
    out[k as StatKey] = rollAround(k as StatKey, mid, roll());
  }
  return out;
}

export function hashUnit(seed: string, i: number): number {
  let h = 2166136261;
  const s = `${seed}:${i}`;
  for (let n = 0; n < s.length; n++) h = Math.imul(h ^ s.charCodeAt(n), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

export function schoolFromTags(tags: string[] | undefined): MagicSchool | null {
  if (!tags?.includes("magic")) return null;
  if (tags.includes("chain")) return "chain";
  if (tags.includes("fire")) return "fire";
  if (tags.includes("frost")) return "frost";
  return "fire";
}

export const EQUIP_SLOTS = [
  "Head",
  "Chest",
  "Gloves",
  "Legs",
  "Boots",
  "Weapon",
  "Offhand",
  "Neck",
  "Ring1",
  "Ring2",
] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

export const CLASS_BASE = {
  Ironclad: {
    health: 140,
    damage: 12,
    armor: 8,
    critChance: 5,
    critDamage: 150,
    dodge: 3,
    lifesteal: 0,
    passive: "Ironclad: +12% Armor, +8% Health",
    pass: { armor: 12, healthPct: 8 } as Record<string, number>,
  },
  Shadehand: {
    health: 100,
    damage: 14,
    armor: 3,
    critChance: 12,
    critDamage: 175,
    dodge: 10,
    lifesteal: 4,
    passive: "Shadehand: +8% Crit, +6% Dodge, +4% Lifesteal",
    pass: { critChance: 8, dodge: 6, lifesteal: 4 },
  },
  Thornbow: {
    health: 110,
    damage: 13,
    armor: 4,
    critChance: 9,
    critDamage: 160,
    dodge: 7,
    lifesteal: 0,
    passive: "Thornbow: +10% Luck, +5% Crit",
    pass: { luck: 10, critChance: 5 },
  },
} as const;

export type CharClass = keyof typeof CLASS_BASE;
