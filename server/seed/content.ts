import { sanitizeStats } from "../engine/stats.ts";
import { TALENTS } from "../engine/talents.ts";
import { generateBandItems } from "./itemBand.ts";

export type SetDef = {
  id: string;
  name: string;
  flavor: string;
  bonus_2: string;
  bonus_3: string;
  bonus_4: string;
  bonus_5: string;
};

const none = JSON.stringify({});

export const SETS: SetDef[] = [
  {
    id: "oathbound",
    name: "Oathbound Ward",
    flavor: "Vows hammered into steel.",
    bonus_2: none,
    bonus_3: JSON.stringify({ armor: 16, health: 40 }),
    bonus_4: none,
    bonus_5: JSON.stringify({ armor: 16, health: 60, damage: 12, regen: 4 }),
  },
  {
    id: "redhowl",
    name: "Red Howl",
    flavor: "Blood answers blood.",
    bonus_2: none,
    bonus_3: JSON.stringify({ damage: 14, critChance: 6 }),
    bonus_4: none,
    bonus_5: JSON.stringify({ damage: 20, critChance: 10, bleed: 12, lifesteal: 6 }),
  },
  {
    id: "briarvigil",
    name: "Briar Vigil",
    flavor: "Thorns keep the road.",
    bonus_2: none,
    bonus_3: JSON.stringify({ lootChance: 12, critChance: 6 }),
    bonus_4: none,
    bonus_5: JSON.stringify({ lootChance: 18, critChance: 10, dodge: 10, goldFind: 10 }),
  },
  {
    id: "silentcowl",
    name: "Silent Cowl",
    flavor: "A breath, then a grave.",
    bonus_2: none,
    bonus_3: JSON.stringify({ dodge: 10, critChance: 8, poison: 4 }),
    bonus_4: none,
    bonus_5: JSON.stringify({ dodge: 14, critChance: 14, poison: 12, execute: 15 }),
  },
  {
    id: "emberreliquary",
    name: "Ember Reliquary",
    flavor: "Holy fire in a locked casket.",
    bonus_2: none,
    bonus_3: JSON.stringify({ fire: 10, armor: 8, health: 20 }),
    bonus_4: none,
    bonus_5: JSON.stringify({ fire: 20, armor: 16, health: 50, lifesteal: 4 }),
  },
  {
    id: "gallowsbrand",
    name: "Gallows Brand",
    flavor: "Sentence first, steel second.",
    bonus_2: none,
    bonus_3: JSON.stringify({ execute: 18, critDamage: 20 }),
    bonus_4: none,
    bonus_5: JSON.stringify({ execute: 35, critDamage: 40, damage: 14, bleed: 8 }),
  },
  {
    id: "deepvein",
    name: "Deepvein Compact",
    flavor: "Ore remembers the miner.",
    bonus_2: none,
    bonus_3: JSON.stringify({ mining: 16, goldFind: 12, armorPen: 6 }),
    bonus_4: none,
    bonus_5: JSON.stringify({ mining: 25, goldFind: 22, armorPen: 14, damage: 12 }),
  },
  {
    id: "anvilcovenant",
    name: "Anvil Covenant",
    flavor: "Every blow is a prayer.",
    bonus_2: JSON.stringify({ armor: 6, damage: 4 }),
    bonus_3: JSON.stringify({ armor: 10, damage: 8, health: 15 }),
    bonus_4: none,
    bonus_5: none,
  },
  {
    id: "crimsonthirst",
    name: "Crimson Thirst",
    flavor: "The night drinks first.",
    bonus_2: none,
    bonus_3: JSON.stringify({ lifesteal: 10, damage: 6 }),
    bonus_4: none,
    bonus_5: JSON.stringify({ lifesteal: 18, damage: 14, health: 35, regen: 3 }),
  },
  {
    id: "censerwoe",
    name: "Censer of Woe",
    flavor: "Mercy smells of vinegar and ash.",
    bonus_2: none,
    bonus_3: JSON.stringify({ poison: 12, dodge: 6, lootChance: 6 }),
    bonus_4: none,
    bonus_5: JSON.stringify({ poison: 22, dodge: 12, lootChance: 12, armor: 8 }),
  },
  {
    id: "gravetithe",
    name: "Grave Tithe",
    flavor: "The dead pay in iron.",
    bonus_2: JSON.stringify({ undeadDamage: 12 }),
    bonus_3: JSON.stringify({ undeadDamage: 20, health: 20 }),
    bonus_4: none,
    bonus_5: none,
  },
  {
    id: "hearthless",
    name: "Hearthless March",
    flavor: "No roof. Only road.",
    bonus_2: none,
    bonus_3: JSON.stringify({ goldFind: 14, health: 20, dodge: 4 }),
    bonus_4: none,
    bonus_5: JSON.stringify({ goldFind: 25, health: 45, dodge: 10, lootChance: 8 }),
  },
  {
    id: "ironorchard",
    name: "Iron Orchard",
    flavor: "Harvest is a kind of war.",
    bonus_2: none,
    bonus_3: JSON.stringify({ bleed: 10, goldFind: 8, damage: 5 }),
    bonus_4: none,
    bonus_5: JSON.stringify({ bleed: 20, goldFind: 16, damage: 12, critChance: 6 }),
  },
  {
    id: "nightmarket",
    name: "Night Market",
    flavor: "Everything has a price in the dark.",
    bonus_2: JSON.stringify({ goldFind: 10, lootChance: 4 }),
    bonus_3: JSON.stringify({ goldFind: 16, lootChance: 8, dodge: 5 }),
    bonus_4: none,
    bonus_5: none,
  },
  {
    id: "stormfen",
    name: "Stormfen Pact",
    flavor: "The marsh keeps secrets, and teeth.",
    bonus_2: JSON.stringify({ poison: 5, health: 15 }),
    bonus_3: JSON.stringify({ poison: 10, health: 25, regen: 2 }),
    bonus_4: none,
    bonus_5: none,
  },
];

export type ItemDefSeed = {
  id: string;
  name: string;
  category: string;
  slot: string | null;
  rarity_min: string;
  base_level: number;
  required_level: number;
  width: number;
  height: number;
  stackable: number;
  max_stack: number;
  base_stats: Record<string, number>;
  affix_pool: unknown[];
  set_id: string | null;
  glyph: string;
  flavor: string;
  tags: string[];
  sell_mult: number;
};

export const ITEM_DEFS: ItemDefSeed[] = [];

function add(d: ItemDefSeed) {
  ITEM_DEFS.push(d);
}

for (const d of generateBandItems(SETS)) add(d as ItemDefSeed);

const ores: { id: string; name: string; rarity_min: string; flavor: string }[] = [
  { id: "ore_copper", name: "Copper Ore", rarity_min: "Common", flavor: "Soft metal, stubborn rock." },
  { id: "ore_iron", name: "Iron Ore", rarity_min: "Uncommon", flavor: "The road's true blood." },
  { id: "ore_gold", name: "Gold Ore", rarity_min: "Rare", flavor: "It remembers kings." },
  { id: "ore_mithril", name: "Mithril Ore", rarity_min: "Epic", flavor: "Light as a lie, hard as a vow." },
  { id: "ore_adamantite", name: "Adamantite Ore", rarity_min: "Legendary", flavor: "The mountain's last argument." },
  { id: "ore_titanium", name: "Titanium Ore", rarity_min: "Mythic", flavor: "Sky-metal, buried wrong." },
];
for (const o of ores) {
  add({
    id: o.id,
    name: o.name,
    category: "ore",
    slot: null,
    rarity_min: o.rarity_min,
    base_level: 1,
    required_level: 1,
    width: 1,
    height: 1,
    stackable: 0,
    max_stack: 1,
    base_stats: {},
    affix_pool: [],
    set_id: null,
    glyph: "stone",
    flavor: o.flavor,
    tags: ["ore"],
    sell_mult: 0.4,
  });
}

for (const d of ITEM_DEFS) {
  d.affix_pool = [];
}
for (const s of SETS) {
  s.bonus_2 = JSON.stringify(sanitizeStats(JSON.parse(s.bonus_2)));
  s.bonus_3 = JSON.stringify(sanitizeStats(JSON.parse(s.bonus_3)));
  s.bonus_4 = JSON.stringify(sanitizeStats(JSON.parse(s.bonus_4)));
  s.bonus_5 = JSON.stringify(sanitizeStats(JSON.parse(s.bonus_5)));
}

export const SKILLS = TALENTS;

export const REGIONS = [
  { id: 1, slug: "mudgate", name: "Mudgate Hamlet", theme: "A soaked village of tax-weary folk and hungry dogs.", description: "Thatched roofs, open sewers, and knives behind smiles.", min_level: 1 },
  { id: 2, slug: "briarwood", name: "Briarwood", theme: "A forest that eats paths.", description: "Thorns, snares, and eyes in the leaves.", min_level: 4 },
  { id: 3, slug: "deepvein", name: "Deepvein Pits", theme: "Collapsed mines and lantern-ghosts.", description: "Pick-songs echo where the air is thin.", min_level: 7 },
  { id: 4, slug: "tollroad", name: "Tollroad Marches", theme: "Bandit country flying false banners.", description: "Every bridge has a price. Some are blood.", min_level: 10 },
  { id: 5, slug: "stormfen", name: "Stormfen", theme: "A swamp of drowned bells.", description: "Mosquito-priests and things that breathe mud.", min_level: 13 },
  { id: 6, slug: "ruinhold", name: "Ruinhold", theme: "A castle that forgot its king.", description: "Courtyards of rust and unfinished sieges.", min_level: 16 },
  { id: 7, slug: "barrowfield", name: "Barrowfield", theme: "A graveyard that keeps expanding.", description: "Tithes for the dead, collected by the dead.", min_level: 19 },
  { id: 8, slug: "ashridge", name: "Ashridge", theme: "Mountains of cinder and goats with too many teeth.", description: "Wind that tastes of old fires.", min_level: 22 },
  { id: 9, slug: "ironfort", name: "Ironfort", theme: "A living fortress of chained gates.", description: "Drills, gallows, and a very patient warden.", min_level: 26 },
  { id: 10, slug: "cinderking", name: "Cinder Kingdom", theme: "The last road: a realm of ash-thrones.", description: "Where banners burn and do not go out.", min_level: 30 },
];

type EnemySeed = {
  id: string;
  name: string;
  kind: "normal" | "elite" | "boss";
  hp: number;
  damage: number;
  armor: number;
  crit_chance: number;
  attack_speed: number;
  dodge: number;
  abilities: string[];
  region: number;
  glyph: string;
  undead?: boolean;
};

export const ENEMIES: EnemySeed[] = [];

function e(x: EnemySeed) {
  ENEMIES.push(x);
}

const normalNames = [
  [1, "Ditch Cutpurse", "bandit"],
  [1, "Alehouse Brawler", "bandit"],
  [1, "Starved Mastiff", "beast"],
  [1, "Mudgate Levy", "knight"],
  [1, "Hedge Beggar-Knife", "bandit"],
  [2, "Briar Poacher", "bandit"],
  [2, "Wolf of the Thorns", "beast"],
  [2, "Snare-Hermit", "bandit"],
  [2, "Horned Boar", "beast"],
  [2, "Greenwood Cutthroat", "bandit"],
  [3, "Pit Rat", "beast"],
  [3, "Lamp-Thief", "goblin"],
  [3, "Collapsed-Tunnel Ghoul", "undead"],
  [3, "Ore-Wight", "undead"],
  [3, "Deepvein Overseer", "bandit"],
  [4, "False-Banner Rider", "knight"],
  [4, "Bridge Tollman", "bandit"],
  [4, "Camp Orc", "orc"],
  [4, "Road Goblin", "goblin"],
  [4, "Outlaw Squire", "knight"],
  [5, "Fen Leechman", "monster"],
  [5, "Reed Witch", "witch"],
  [5, "Bog Zombie", "undead"],
  [5, "Mosquito Cloud", "beast"],
  [5, "Drowned Bellringer", "undead"],
  [6, "Rust Knight", "knight"],
  [6, "Courtyard Skeleton", "undead"],
  [6, "Siege Goblin", "goblin"],
  [6, "Fallen Man-at-Arms", "knight"],
  [6, "Keep Cultist", "cultist"],
  [7, "Shroud Walker", "undead"],
  [7, "Barrow Skeleton", "undead"],
  [7, "Grave Zombie", "undead"],
  [7, "Bone Choirist", "undead"],
  [7, "Night Necrolyte", "necromancer"],
  [8, "Cinder Goat", "beast"],
  [8, "Ridge Orc", "orc"],
  [8, "Ash Bandit", "bandit"],
  [8, "Wind-Witch", "witch"],
  [8, "Cliff Ghoul", "undead"],
  [9, "Ironfort Drillmaster", "knight"],
  [9, "Chain Warden", "knight"],
  [9, "Gallows Cultist", "cultist"],
  [9, "Fort Orc", "orc"],
  [9, "Mute Executioner", "knight"],
  [10, "Ash Thrall", "undead"],
  [10, "Cinder Knight", "knight"],
  [10, "Black Choir Cultist", "cultist"],
  [10, "Ember Necromancer", "necromancer"],
  [10, "Crownless Guard", "knight"],
] as const;

let ni = 0;
for (const [region, name, kind] of normalNames) {
  ni++;
  const r = Number(region);
  e({
    id: `n_${ni}`,
    name,
    kind: "normal",
    hp: 40 + r * 22,
    damage: 6 + r * 3,
    armor: 1 + Math.floor(r * 1.4),
    crit_chance: 0.04 + r * 0.004,
    attack_speed: 0.9 + (ni % 3) * 0.05,
    dodge: 0.02 + (r % 4) * 0.01,
    abilities: kind === "witch" ? ["poison"] : kind === "undead" ? ["undead"] : kind === "cultist" ? ["fire"] : ["strike"],
    region: r,
    glyph: kind,
    undead: kind === "undead",
  });
}

const elites: [number, string, string][] = [
  [1, "Mudgate Reeve", "knight"],
  [2, "Briar Alpha", "beast"],
  [3, "Lantern Warden", "undead"],
  [4, "False Baron", "knight"],
  [5, "Fen Hag", "witch"],
  [6, "Keep Castellan", "knight"],
  [7, "Barrow Priest", "necromancer"],
  [8, "Ashridge Chieftain", "orc"],
  [9, "Ironfort Provost", "knight"],
  [10, "Cinder Herald", "cultist"],
];
elites.forEach(([region, name, kind], i) => {
  e({
    id: `e_${i + 1}`,
    name,
    kind: "elite",
    hp: 90 + region * 40,
    damage: 12 + region * 5,
    armor: 6 + region * 2,
    crit_chance: 0.1,
    attack_speed: 1.05,
    dodge: 0.06,
    abilities: ["heavy", kind === "witch" || kind === "necromancer" ? "poison" : "bleed"],
    region,
    glyph: kind,
    undead: kind === "undead" || kind === "necromancer",
  });
});

const bosses: [number, string, string][] = [
  [1, "Hogfather Gristle", "beast"],
  [2, "The Thorn Widow", "witch"],
  [3, "Pick-King Durm", "orc"],
  [4, "Bannerless Hal", "knight"],
  [5, "Bell-Drowned Mire", "monster"],
  [6, "Rustcrown", "knight"],
  [7, "Tithe of Bones", "necromancer"],
  [8, "Goat of Cinders", "beast"],
  [9, "Warden Nine-Chains", "knight"],
  [10, "The Ashen Tithe-King", "monster"],
];
bosses.forEach(([region, name, kind], i) => {
  e({
    id: `b_${i + 1}`,
    name,
    kind: "boss",
    hp: 180 + region * 70,
    damage: 16 + region * 7,
    armor: 10 + region * 3,
    crit_chance: 0.12,
    attack_speed: 0.95,
    dodge: 0.05,
    abilities: ["heavy", "regen", region >= 7 ? "fire" : "bleed"],
    region,
    glyph: kind,
    undead: kind === "necromancer",
  });
});
