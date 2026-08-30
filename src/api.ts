export async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
    body: opts.body && typeof opts.body !== "string" ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "The road is closed.");
  return data as T;
}

export type Item = {
  id: string;
  definition_id: string;
  rarity: string;
  item_level: number;
  required_level: number;
  stats: Record<string, number>;
  affixes: { key: string; value: number }[];
  statRanges?: Record<string, { min: number; max: number }>;
  magicSchool?: "chain" | "fire" | "frost" | null;
  width: number;
  height: number;
  rotated: number;
  stack: number;
  grid_x: number | null;
  grid_y: number | null;
  equip_slot: string | null;
  location: string;
  value: number;
  definition: {
    name: string;
    category: string;
    slot: string | null;
    glyph: string;
    flavor: string;
    set_id: string | null;
    tags: string[];
    icon?: string;
  };
  set: { id: string; name: string } | null;
};

export const SLOTS = ["Head", "Chest", "Gloves", "Legs", "Boots", "Weapon", "Offhand", "Neck", "Ring1", "Ring2"] as const;

export const EQUIP_LAYOUT: { slot: (typeof SLOTS)[number]; pos: string }[] = [
  { slot: "Head", pos: "head" },
  { slot: "Neck", pos: "neck" },
  { slot: "Gloves", pos: "gloves" },
  { slot: "Chest", pos: "chest" },
  { slot: "Offhand", pos: "offhand" },
  { slot: "Weapon", pos: "weapon" },
  { slot: "Legs", pos: "legs" },
  { slot: "Ring1", pos: "ring1" },
  { slot: "Ring2", pos: "ring2" },
  { slot: "Boots", pos: "boots" },
];

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

export const STAT_LABEL: Record<string, string> = {
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

export const PCT = new Set([
  "dodge",
  "luck",
  "critChance",
  "critDamage",
  "lifesteal",
  "poisonChance",
  "bleedChance",
]);
