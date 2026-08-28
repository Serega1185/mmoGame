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
  };
  set: { id: string; name: string } | null;
};

export const SLOTS = ["Head", "Chest", "Gloves", "Legs", "Boots", "Weapon", "Offhand", "Neck", "Ring1", "Ring2", "Accessory"];

export const STAT_LABEL: Record<string, string> = {
  health: "Health",
  damage: "Damage",
  armor: "Armor",
  critChance: "Crit Chance",
  critDamage: "Crit Damage",
  attackSpeed: "Attack Speed",
  dodge: "Dodge",
  lifesteal: "Lifesteal",
  armorPen: "Armor Pen",
  regen: "Regen",
  goldFind: "Gold Find",
  lootChance: "Loot Chance",
  poison: "Poison",
  bleed: "Bleed",
  fire: "Fire",
  mining: "Mining",
  undeadDamage: "vs Undead",
  execute: "Execute",
};

export const PCT = new Set([
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
