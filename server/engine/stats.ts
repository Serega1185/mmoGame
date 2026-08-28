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
  Common: [1, 2],
  Uncommon: [2, 3],
  Rare: [3, 4],
  Epic: [4, 5],
  Legendary: [5, 6],
  Mythic: [6, 7],
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
  "armor",
  "critChance",
  "critDamage",
  "attackSpeed",
  "dodge",
  "lifesteal",
  "armorPen",
  "regen",
  "goldFind",
  "lootChance",
  "poison",
  "bleed",
  "fire",
  "mining",
  "undeadDamage",
  "execute",
] as const;

export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Partial<Record<StatKey, number>>;

export const STAT_LABEL: Record<StatKey, string> = {
  health: "Health",
  damage: "Damage",
  armor: "Armor",
  critChance: "Critical Chance",
  critDamage: "Critical Damage",
  attackSpeed: "Attack Speed",
  dodge: "Dodge",
  lifesteal: "Lifesteal",
  armorPen: "Armor Penetration",
  regen: "Health Regeneration",
  goldFind: "Gold Find",
  lootChance: "Loot Chance",
  poison: "Poison Damage",
  bleed: "Bleed Damage",
  fire: "Fire Damage",
  mining: "Mining Bonus",
  undeadDamage: "Undead Damage",
  execute: "Execute Damage",
};

export const PERCENT_STATS = new Set<StatKey>([
  "critChance",
  "critDamage",
  "attackSpeed",
  "dodge",
  "lifesteal",
  "armorPen",
  "goldFind",
  "lootChance",
  "mining",
  "undeadDamage",
  "execute",
]);

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
    if (v) out[k] = Math.round(v * mult * 10) / 10;
  }
  return out;
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
  "Accessory",
] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

export const CLASS_BASE = {
  Ironclad: {
    health: 140,
    damage: 12,
    armor: 8,
    critChance: 5,
    critDamage: 150,
    attackSpeed: 0.9,
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
    attackSpeed: 1.15,
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
    attackSpeed: 1.05,
    dodge: 7,
    lifesteal: 0,
    passive: "Thornbow: +10% Loot Chance, +6% Gold Find, +5% Crit",
    pass: { lootChance: 10, goldFind: 6, critChance: 5 },
  },
} as const;

export type CharClass = keyof typeof CLASS_BASE;
