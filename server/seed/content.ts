import { exclusiveDamage, padItemStats, sanitizeStats, type StatKey } from "../engine/stats.ts";
import { TALENTS } from "../engine/talents.ts";

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
  affix_pool: StatKeyPool;
  set_id: string | null;
  glyph: string;
  flavor: string;
  tags: string[];
  sell_mult: number;
};

type StatKeyPool = { key: keyof Stats; min: number; max: number }[];

const WEP: StatKeyPool = [];
const ARM: StatKeyPool = [];
const JWL: StatKeyPool = [];

export const ITEM_DEFS: ItemDefSeed[] = [];

function add(d: ItemDefSeed) {
  ITEM_DEFS.push(d);
}

// Starter / low
const weapons: Omit<ItemDefSeed, "affix_pool" | "stackable" | "max_stack" | "sell_mult">[] = [
  { id: "ash_knife", name: "Ash Knife", category: "weapon", slot: "Weapon", rarity_min: "Common", base_level: 1, required_level: 1, width: 1, height: 2, base_stats: { damage: 6, critChance: 4 }, set_id: null, glyph: "knife", flavor: "A kitchen blade that learned war.", tags: ["dagger"] },
  { id: "peat_shortsword", name: "Peat Shortsword", category: "weapon", slot: "Weapon", rarity_min: "Common", base_level: 1, required_level: 1, width: 1, height: 3, base_stats: { damage: 8 }, set_id: "hearthless", glyph: "sword", flavor: "Cheap iron, honest edge.", tags: ["sword"] },
  { id: "hedge_hatchet", name: "Hedge Hatchet", category: "weapon", slot: "Weapon", rarity_min: "Common", base_level: 1, required_level: 1, width: 2, height: 2, base_stats: { damage: 9, bleed: 2 }, set_id: "ironorchard", glyph: "axe", flavor: "Meant for branches. Works on men.", tags: ["axe"] },
  { id: "field_sickle", name: "Field Sickle", category: "weapon", slot: "Weapon", rarity_min: "Uncommon", base_level: 3, required_level: 2, width: 2, height: 2, base_stats: { damage: 10, bleed: 4, goldFind: 4 }, set_id: "ironorchard", glyph: "sickle", flavor: "Harvests grain or throats.", tags: ["tool"] },
  { id: "miners_pick", name: "Miner's Pickaxe", category: "weapon", slot: "Weapon", rarity_min: "Uncommon", base_level: 4, required_level: 3, width: 2, height: 3, base_stats: { damage: 12, armorPen: 8, mining: 12 }, set_id: "deepvein", glyph: "pick", flavor: "Stone yields. So do skulls.", tags: ["tool", "pick"] },
  { id: "peat_shovel", name: "Peatcutter's Spade", category: "weapon", slot: "Weapon", rarity_min: "Uncommon", base_level: 4, required_level: 3, width: 1, height: 3, base_stats: { damage: 11, armor: 4, undeadDamage: 10 }, set_id: "gravetithe", glyph: "shovel", flavor: "A grave is just a hole with a name.", tags: ["tool", "shovel"] },
  { id: "forge_mallet", name: "Forge Mallet", category: "weapon", slot: "Weapon", rarity_min: "Uncommon", base_level: 5, required_level: 4, width: 2, height: 2, base_stats: { damage: 13, fire: 3 }, set_id: "anvilcovenant", glyph: "hammer", flavor: "Still warm from the anvil.", tags: ["hammer"] },
  { id: "watch_spear", name: "Watch Spear", category: "weapon", slot: "Weapon", rarity_min: "Common", base_level: 5, required_level: 4, width: 1, height: 4, base_stats: { damage: 12, armorPen: 4 }, set_id: "oathbound", glyph: "spear", flavor: "Keeps wolves — and taxmen — at length.", tags: ["spear"] },
  { id: "briar_bow", name: "Briar Bow", category: "weapon", slot: "Weapon", rarity_min: "Uncommon", base_level: 6, required_level: 5, width: 1, height: 3, base_stats: { damage: 11, critChance: 6, lootChance: 5 }, set_id: "briarvigil", glyph: "bow", flavor: "Strung with bramble-gut.", tags: ["bow"] },
  { id: "latch_crossbow", name: "Latch Crossbow", category: "weapon", slot: "Weapon", rarity_min: "Rare", base_level: 8, required_level: 6, width: 2, height: 2, base_stats: { damage: 16, armorPen: 8, critDamage: 15 }, set_id: "silentcowl", glyph: "crossbow", flavor: "A quiet argument.", tags: ["crossbow"] },
  { id: "iron_longsword", name: "Iron Longsword", category: "weapon", slot: "Weapon", rarity_min: "Common", base_level: 8, required_level: 6, width: 1, height: 3, base_stats: { damage: 15 }, set_id: "oathbound", glyph: "sword", flavor: "The road's most common prayer.", tags: ["sword"] },
  { id: "steel_axe", name: "Steel Felling Axe", category: "weapon", slot: "Weapon", rarity_min: "Uncommon", base_level: 10, required_level: 8, width: 2, height: 2, base_stats: { damage: 18, bleed: 4 }, set_id: "redhowl", glyph: "axe", flavor: "Trees or shields — it does not care.", tags: ["axe"] },
  { id: "knight_axe", name: "Knight's Pollaxe", category: "weapon", slot: "Weapon", rarity_min: "Rare", base_level: 20, required_level: 16, width: 2, height: 3, base_stats: { damage: 28, armorPen: 10 }, set_id: "oathbound", glyph: "halberd", flavor: "Made to unhorse pride.", tags: ["axe"] },
  { id: "gallows_axe", name: "Gallows Axe", category: "weapon", slot: "Weapon", rarity_min: "Epic", base_level: 24, required_level: 20, width: 2, height: 3, base_stats: { damage: 30, execute: 20, bleed: 6 }, set_id: "gallowsbrand", glyph: "axe", flavor: "The last tax the condemned pay.", tags: ["axe", "execute"] },
  { id: "vein_pick", name: "Deepvein Pickaxe", category: "weapon", slot: "Weapon", rarity_min: "Rare", base_level: 18, required_level: 14, width: 2, height: 3, base_stats: { damage: 24, armorPen: 14, mining: 18, goldFind: 8 }, set_id: "deepvein", glyph: "pick", flavor: "Sings when it tastes gold.", tags: ["pick"] },
  { id: "gold_pick", name: "Gilded Pickaxe", category: "weapon", slot: "Weapon", rarity_min: "Legendary", base_level: 32, required_level: 28, width: 2, height: 3, base_stats: { damage: 36, goldFind: 18, critChance: 8, mining: 15 }, set_id: "deepvein", glyph: "pick", flavor: "Ore that learned vanity.", tags: ["pick"] },
  { id: "grave_shovel", name: "Gravedigger's Spade", category: "weapon", slot: "Weapon", rarity_min: "Rare", base_level: 16, required_level: 12, width: 1, height: 3, base_stats: { damage: 20, undeadDamage: 22, lootChance: 8 }, set_id: "gravetithe", glyph: "shovel", flavor: "Knows every cemetery by smell.", tags: ["shovel"] },
  { id: "night_dagger", name: "Nightmarket Stiletto", category: "weapon", slot: "Weapon", rarity_min: "Rare", base_level: 14, required_level: 10, width: 1, height: 2, base_stats: { damage: 14, poison: 8, critChance: 10 }, set_id: "silentcowl", glyph: "knife", flavor: "A receipt written in veins.", tags: ["dagger", "poison"] },
  { id: "plague_censer", name: "Woe Censer", category: "weapon", slot: "Weapon", rarity_min: "Epic", base_level: 22, required_level: 18, width: 2, height: 2, base_stats: { damage: 18, poison: 14, dodge: 4 }, set_id: "censerwoe", glyph: "censer", flavor: "Smoke that judges the living.", tags: ["tool", "poison"] },
  { id: "vampire_maul", name: "Thirsting Maul", category: "weapon", slot: "Weapon", rarity_min: "Epic", base_level: 26, required_level: 22, width: 2, height: 3, base_stats: { damage: 32, lifesteal: 10 }, set_id: "crimsonthirst", glyph: "hammer", flavor: "It drinks the bounce of bone.", tags: ["hammer"] },
  { id: "ember_mace", name: "Reliquary Mace", category: "weapon", slot: "Weapon", rarity_min: "Rare", base_level: 18, required_level: 14, width: 1, height: 3, base_stats: { damage: 22, fire: 10 }, set_id: "emberreliquary", glyph: "mace", flavor: "A saint's knuckle, iron-wrapped.", tags: ["mace"] },
  { id: "fen_spear", name: "Stormfen Gig", category: "weapon", slot: "Weapon", rarity_min: "Rare", base_level: 15, required_level: 12, width: 1, height: 4, base_stats: { damage: 19, poison: 6 }, set_id: "stormfen", glyph: "spear", flavor: "For eels, and worse.", tags: ["spear"] },
  { id: "twohand_iron", name: "Cart-Splitter", category: "weapon", slot: "Weapon", rarity_min: "Uncommon", base_level: 12, required_level: 10, width: 2, height: 4, base_stats: { damage: 26, critDamage: 15 }, set_id: "redhowl", glyph: "greatsword", flavor: "Too large for manners.", tags: ["sword", "twohand"] },
  { id: "halberd_watch", name: "Gate Halberd", category: "weapon", slot: "Weapon", rarity_min: "Rare", base_level: 20, required_level: 16, width: 1, height: 4, base_stats: { damage: 27, armorPen: 8, armor: 4 }, set_id: "oathbound", glyph: "halberd", flavor: "The wall's long finger.", tags: ["halberd"] },
  { id: "demon_hammer", name: "Ashen War Hammer", category: "weapon", slot: "Weapon", rarity_min: "Legendary", base_level: 40, required_level: 36, width: 2, height: 3, base_stats: { damage: 48, fire: 12, armorPen: 12 }, set_id: "anvilcovenant", glyph: "hammer", flavor: "Forged where the sky burned.", tags: ["hammer"] },
  { id: "ancient_war_axe", name: "Barrow War Axe", category: "weapon", slot: "Weapon", rarity_min: "Mythic", base_level: 60, required_level: 50, width: 2, height: 3, base_stats: { damage: 64, bleed: 16, execute: 20 }, set_id: "gallowsbrand", glyph: "axe", flavor: "Pulled from a king's last argument.", tags: ["axe"] },
  { id: "chain_hook", name: "Chain Hook", category: "weapon", slot: "Weapon", rarity_min: "Uncommon", base_level: 9, required_level: 7, width: 2, height: 2, base_stats: { damage: 14, armorPen: 6 }, set_id: "nightmarket", glyph: "hook", flavor: "For barrels, doors, and fleeing debtors.", tags: ["tool"] },
  { id: "torch_iron", name: "Caged Torch", category: "weapon", slot: "Offhand", rarity_min: "Common", base_level: 2, required_level: 1, width: 1, height: 2, base_stats: { fire: 4, lootChance: 3 }, set_id: null, glyph: "torch", flavor: "Light is a weapon in cellars.", tags: ["tool"] },
  { id: "wood_buckler", name: "Oak Buckler", category: "armor", slot: "Offhand", rarity_min: "Common", base_level: 1, required_level: 1, width: 2, height: 2, base_stats: { armor: 6, thorns: 4 }, set_id: "hearthless", glyph: "shield", flavor: "A door-lid with ambition.", tags: ["shield"] },
  { id: "iron_kite", name: "Kite of the March", category: "armor", slot: "Offhand", rarity_min: "Uncommon", base_level: 10, required_level: 8, width: 2, height: 3, base_stats: { armor: 14, health: 15, barrier: 1 }, set_id: "oathbound", glyph: "shield", flavor: "Painted with a road, not a saint.", tags: ["shield"] },
  { id: "great_pavise", name: "Siege Pavise", category: "armor", slot: "Offhand", rarity_min: "Epic", base_level: 28, required_level: 24, width: 3, height: 3, base_stats: { armor: 28, health: 40, barrier: 2, dodge: -2 }, set_id: "oathbound", glyph: "shield", flavor: "A wall you can lift, barely.", tags: ["shield"] },
];

for (const w of weapons) {
  add({
    ...w,
    affix_pool: WEP,
    stackable: 0,
    max_stack: 1,
    sell_mult: 1,
  });
}

const armors: typeof weapons = [
  { id: "wool_hood", name: "Wool Hood", category: "armor", slot: "Head", rarity_min: "Common", base_level: 1, required_level: 1, width: 2, height: 2, base_stats: { armor: 2, health: 8 }, set_id: "hearthless", glyph: "hood", flavor: "Keeps rain out of the eyes.", tags: ["cloth"] },
  { id: "iron_cap", name: "Iron Cap", category: "armor", slot: "Head", rarity_min: "Common", base_level: 4, required_level: 3, width: 2, height: 2, base_stats: { armor: 5 }, set_id: "oathbound", glyph: "helm", flavor: "A bowl for brains.", tags: ["plate"] },
  { id: "plague_mask", name: "Woe Beak", category: "armor", slot: "Head", rarity_min: "Rare", base_level: 18, required_level: 14, width: 2, height: 2, base_stats: { armor: 8, poison: 6, dodge: 4 }, set_id: "censerwoe", glyph: "mask", flavor: "Herbs packed into dread.", tags: ["leather"] },
  { id: "howl_helm", name: "Howl Helm", category: "armor", slot: "Head", rarity_min: "Rare", base_level: 16, required_level: 12, width: 2, height: 2, base_stats: { armor: 10, damage: 4, critChance: 4 }, set_id: "redhowl", glyph: "helm", flavor: "Open-faced, so the scream can leave.", tags: ["plate"] },
  { id: "miner_helm", name: "Lamp Helm", category: "armor", slot: "Head", rarity_min: "Uncommon", base_level: 8, required_level: 6, width: 2, height: 2, base_stats: { armor: 6, mining: 8, lootChance: 4 }, set_id: "deepvein", glyph: "helm", flavor: "A candle on a skull-cage.", tags: ["mail"] },
  { id: "padded_jack", name: "Padded Jack", category: "armor", slot: "Chest", rarity_min: "Common", base_level: 1, required_level: 1, width: 2, height: 3, base_stats: { armor: 6, health: 12 }, set_id: "hearthless", glyph: "chest", flavor: "Stuffed with rags and luck.", tags: ["cloth"] },
  { id: "hide_jerkin", name: "Hide Jerkin", category: "armor", slot: "Chest", rarity_min: "Common", base_level: 5, required_level: 4, width: 2, height: 3, base_stats: { armor: 9, dodge: 3 }, set_id: "briarvigil", glyph: "chest", flavor: "Still smells of the deer.", tags: ["leather"] },
  { id: "mail_hauberk", name: "Ring Hauberk", category: "armor", slot: "Chest", rarity_min: "Uncommon", base_level: 10, required_level: 8, width: 2, height: 3, base_stats: { armor: 16, health: 18 }, set_id: "oathbound", glyph: "mail", flavor: "A thousand tiny oaths.", tags: ["mail"] },
  { id: "plate_cuirass", name: "March Cuirass", category: "armor", slot: "Chest", rarity_min: "Rare", base_level: 20, required_level: 16, width: 2, height: 3, base_stats: { armor: 24, health: 30 }, set_id: "oathbound", glyph: "plate", flavor: "Dents like a ledger of battles.", tags: ["plate"] },
  { id: "blood_cuirass", name: "Thirsted Cuirass", category: "armor", slot: "Chest", rarity_min: "Epic", base_level: 28, required_level: 24, width: 2, height: 3, base_stats: { armor: 22, lifesteal: 8, health: 25 }, set_id: "crimsonthirst", glyph: "plate", flavor: "The rivets never quite dry.", tags: ["plate"] },
  { id: "leather_gloves", name: "Work Gloves", category: "armor", slot: "Gloves", rarity_min: "Common", base_level: 1, required_level: 1, width: 2, height: 1, base_stats: { armor: 2 }, set_id: "anvilcovenant", glyph: "gloves", flavor: "Blisters postponed.", tags: ["leather"] },
  { id: "mail_gauntlets", name: "Mail Gauntlets", category: "armor", slot: "Gloves", rarity_min: "Uncommon", base_level: 10, required_level: 8, width: 2, height: 2, base_stats: { armor: 6, damage: 2 }, set_id: "oathbound", glyph: "gloves", flavor: "Fists become furniture.", tags: ["mail"] },
  { id: "plague_gloves", name: "Pitch Gloves", category: "armor", slot: "Gloves", rarity_min: "Rare", base_level: 16, required_level: 12, width: 2, height: 1, base_stats: { armor: 4, poison: 5 }, set_id: "censerwoe", glyph: "gloves", flavor: "Sticky with remedies.", tags: ["leather"] },
  { id: "wool_hosen", name: "Wool Hosen", category: "armor", slot: "Legs", rarity_min: "Common", base_level: 1, required_level: 1, width: 2, height: 2, base_stats: { armor: 3, health: 8 }, set_id: "hearthless", glyph: "legs", flavor: "Itchy salvation.", tags: ["cloth"] },
  { id: "mail_chausses", name: "Mail Chausses", category: "armor", slot: "Legs", rarity_min: "Uncommon", base_level: 12, required_level: 10, width: 2, height: 3, base_stats: { armor: 12, health: 14 }, set_id: "oathbound", glyph: "legs", flavor: "Walking chain.", tags: ["mail"] },
  { id: "howl_kilt", name: "Howl Wraps", category: "armor", slot: "Legs", rarity_min: "Rare", base_level: 18, required_level: 14, width: 2, height: 2, base_stats: { armor: 8, damage: 6, critChance: 4 }, set_id: "redhowl", glyph: "legs", flavor: "Bare knees, full fury.", tags: ["leather"] },
  { id: "clogs", name: "Road Clogs", category: "armor", slot: "Boots", rarity_min: "Common", base_level: 1, required_level: 1, width: 2, height: 1, base_stats: { armor: 2, dodge: 2 }, set_id: "hearthless", glyph: "boots", flavor: "Wood against mud.", tags: ["cloth"] },
  { id: "hobnail", name: "Hobnail Boots", category: "armor", slot: "Boots", rarity_min: "Uncommon", base_level: 8, required_level: 6, width: 2, height: 2, base_stats: { armor: 6, health: 8 }, set_id: "deepvein", glyph: "boots", flavor: "Sparks on stone.", tags: ["leather"] },
  { id: "silent_soles", name: "Felt Soles", category: "armor", slot: "Boots", rarity_min: "Rare", base_level: 14, required_level: 10, width: 2, height: 1, base_stats: { armor: 4, dodge: 8, critChance: 3 }, set_id: "silentcowl", glyph: "boots", flavor: "The floor forgets you.", tags: ["leather"] },
  { id: "fen_waders", name: "Fen Waders", category: "armor", slot: "Boots", rarity_min: "Uncommon", base_level: 12, required_level: 10, width: 2, height: 2, base_stats: { armor: 5, poison: 4, health: 10 }, set_id: "stormfen", glyph: "boots", flavor: "Keeps leeches honest.", tags: ["leather"] },
];

for (const a of armors) {
  add({ ...a, affix_pool: ARM, stackable: 0, max_stack: 1, sell_mult: 1 });
}

const jewels: typeof weapons = [
  { id: "twine_cord", name: "Twine Cord", category: "jewelry", slot: "Neck", rarity_min: "Common", base_level: 1, required_level: 1, width: 1, height: 1, base_stats: { health: 6 }, set_id: null, glyph: "neck", flavor: "A knot against bad luck.", tags: ["neck"] },
  { id: "oath_torque", name: "Oath Torque", category: "jewelry", slot: "Neck", rarity_min: "Rare", base_level: 16, required_level: 12, width: 1, height: 1, base_stats: { armor: 6, health: 16 }, set_id: "oathbound", glyph: "neck", flavor: "Closes like a vow.", tags: ["neck"] },
  { id: "blood_choker", name: "Crimson Choker", category: "jewelry", slot: "Neck", rarity_min: "Epic", base_level: 24, required_level: 20, width: 1, height: 1, base_stats: { lifesteal: 8, health: 12 }, set_id: "crimsonthirst", glyph: "neck", flavor: "Warm even in winter.", tags: ["neck"] },
  { id: "copper_ring", name: "Copper Ring", category: "jewelry", slot: "Ring1", rarity_min: "Common", base_level: 1, required_level: 1, width: 1, height: 1, base_stats: { goldFind: 4 }, set_id: "nightmarket", glyph: "ring", flavor: "Green at the edges.", tags: ["ring"] },
  { id: "iron_signet", name: "Iron Signet", category: "jewelry", slot: "Ring1", rarity_min: "Uncommon", base_level: 8, required_level: 6, width: 1, height: 1, base_stats: { armor: 3, damage: 2 }, set_id: "oathbound", glyph: "ring", flavor: "A seal of a forgotten house.", tags: ["ring"] },
  { id: "poison_band", name: "Venom Band", category: "jewelry", slot: "Ring1", rarity_min: "Rare", base_level: 14, required_level: 10, width: 1, height: 1, base_stats: { poison: 6, critChance: 4 }, set_id: "silentcowl", glyph: "ring", flavor: "Never lick it.", tags: ["ring"] },
  { id: "gold_tooth", name: "Pawned Tooth", category: "jewelry", slot: "Ring2", rarity_min: "Uncommon", base_level: 6, required_level: 4, width: 1, height: 1, base_stats: { goldFind: 8 }, set_id: null, glyph: "ring", flavor: "Someone smiled for the last time.", tags: ["ring"] },
  { id: "ember_seal", name: "Ember Seal", category: "jewelry", slot: "Ring2", rarity_min: "Rare", base_level: 18, required_level: 14, width: 1, height: 1, base_stats: { fire: 6, health: 10 }, set_id: "emberreliquary", glyph: "ring", flavor: "Wax that never cools.", tags: ["ring"] },
  { id: "grave_charm", name: "Barrow Charm", category: "jewelry", slot: "Neck", rarity_min: "Rare", base_level: 12, required_level: 10, width: 1, height: 1, base_stats: { undeadDamage: 12, lootChance: 6 }, set_id: null, glyph: "charm", flavor: "A fingerbone on a string.", tags: ["neck"] },
  { id: "market_purse", name: "Night Purse", category: "jewelry", slot: "Ring1", rarity_min: "Uncommon", base_level: 8, required_level: 6, width: 1, height: 1, base_stats: { goldFind: 12, lootChance: 4 }, set_id: "nightmarket", glyph: "bag", flavor: "Has more pockets than honesty.", tags: ["ring"] },
  { id: "censer_vial", name: "Vial of Woe", category: "jewelry", slot: "Neck", rarity_min: "Epic", base_level: 22, required_level: 18, width: 1, height: 1, base_stats: { poison: 8, dodge: 4 }, set_id: "censerwoe", glyph: "vial", flavor: "Do not uncork indoors.", tags: ["neck"] },
  { id: "anvil_token", name: "Anvil Token", category: "jewelry", slot: "Ring1", rarity_min: "Uncommon", base_level: 10, required_level: 8, width: 1, height: 1, base_stats: { armor: 4, fire: 3 }, set_id: null, glyph: "charm", flavor: "A chip of the first anvil.", tags: ["ring"] },
];

for (const j of jewels) {
  add({ ...j, affix_pool: JWL, stackable: 0, max_stack: 1, sell_mult: 1.1 });
}

const moreWeapons: typeof weapons = [
  { id: "club_knob", name: "Knobbed Club", category: "weapon", slot: "Weapon", rarity_min: "Common", base_level: 2, required_level: 1, width: 1, height: 3, base_stats: { damage: 9 }, set_id: null, glyph: "mace", flavor: "Forestry, applied.", tags: ["mace"] },
  { id: "bandit_falchion", name: "Toll Falchion", category: "weapon", slot: "Weapon", rarity_min: "Uncommon", base_level: 11, required_level: 8, width: 1, height: 3, base_stats: { damage: 17, goldFind: 6 }, set_id: "nightmarket", glyph: "sword", flavor: "Collects more than coins.", tags: ["sword"] },
  { id: "orc_cleaver", name: "Camp Cleaver", category: "weapon", slot: "Weapon", rarity_min: "Rare", base_level: 19, required_level: 15, width: 2, height: 2, base_stats: { damage: 25, bleed: 8 }, set_id: "redhowl", glyph: "axe", flavor: "Kitchen steel gone feral.", tags: ["axe"] },
  { id: "bone_spear", name: "Rib Spear", category: "weapon", slot: "Weapon", rarity_min: "Uncommon", base_level: 13, required_level: 10, width: 1, height: 4, base_stats: { damage: 16, undeadDamage: 8 }, set_id: "gravetithe", glyph: "spear", flavor: "The dead arming the living.", tags: ["spear"] },
  { id: "witch_rod", name: "Hag Rod", category: "weapon", slot: "Weapon", rarity_min: "Rare", base_level: 17, required_level: 14, width: 1, height: 3, base_stats: { magicDamage: 18, dodge: 4 }, set_id: "stormfen", glyph: "staff", flavor: "Knotted with drowned hair.", tags: ["staff", "magic", "frost"] },
  { id: "cult_dagger", name: "Choir Knife", category: "weapon", slot: "Weapon", rarity_min: "Epic", base_level: 25, required_level: 20, width: 1, height: 2, base_stats: { damage: 18, fire: 8, critChance: 8 }, set_id: "emberreliquary", glyph: "knife", flavor: "Sang when it cut.", tags: ["dagger"] },
  { id: "fort_pike", name: "Fortress Pike", category: "weapon", slot: "Weapon", rarity_min: "Rare", base_level: 22, required_level: 18, width: 1, height: 4, base_stats: { damage: 29, armor: 5 }, set_id: "oathbound", glyph: "spear", flavor: "Made to deny gates.", tags: ["spear"] },
  { id: "mountain_maul", name: "Ridge Maul", category: "weapon", slot: "Weapon", rarity_min: "Epic", base_level: 30, required_level: 26, width: 2, height: 3, base_stats: { damage: 38, armorPen: 10 }, set_id: "anvilcovenant", glyph: "hammer", flavor: "A boulder with a handle.", tags: ["hammer"] },
  { id: "shadow_bow", name: "Ashleaf Bow", category: "weapon", slot: "Weapon", rarity_min: "Epic", base_level: 26, required_level: 22, width: 1, height: 3, base_stats: { damage: 28, critChance: 12, lootChance: 8 }, set_id: "briarvigil", glyph: "bow", flavor: "Draws like a held breath.", tags: ["bow"] },
  { id: "myth_greatsword", name: "Crownbreaker", category: "weapon", slot: "Weapon", rarity_min: "Mythic", base_level: 55, required_level: 48, width: 2, height: 4, base_stats: { damage: 70, critDamage: 35, execute: 12 }, set_id: "gallowsbrand", glyph: "greatsword", flavor: "Kings remember its weight.", tags: ["sword"] },
];

for (const w of moreWeapons) add({ ...w, affix_pool: WEP, stackable: 0, max_stack: 1, sell_mult: 1 });

const moreArmor: typeof weapons = [
  { id: "brigandine", name: "Riveted Brigandine", category: "armor", slot: "Chest", rarity_min: "Rare", base_level: 15, required_level: 12, width: 2, height: 3, base_stats: { armor: 18, health: 22 }, set_id: "gallowsbrand", glyph: "chest", flavor: "Cloth hiding a conspiracy of plates.", tags: ["plate"] },
  { id: "shadow_cloak", name: "Cowl Cloak", category: "armor", slot: "Chest", rarity_min: "Rare", base_level: 14, required_level: 10, width: 2, height: 3, base_stats: { armor: 8, dodge: 10, critChance: 5 }, set_id: "silentcowl", glyph: "cloak", flavor: "Night tailored.", tags: ["cloth"] },
  { id: "fen_leathers", name: "Reed Leathers", category: "armor", slot: "Chest", rarity_min: "Uncommon", base_level: 11, required_level: 8, width: 2, height: 3, base_stats: { armor: 10, poison: 4, dodge: 4 }, set_id: "stormfen", glyph: "chest", flavor: "Waterproofed with fish fat.", tags: ["leather"] },
  { id: "smith_apron", name: "Smith's Hide Apron", category: "armor", slot: "Chest", rarity_min: "Uncommon", base_level: 9, required_level: 6, width: 2, height: 3, base_stats: { armor: 11, fire: 5 }, set_id: "anvilcovenant", glyph: "chest", flavor: "Scorch-maps of a life's work.", tags: ["leather"] },
  { id: "miner_coat", name: "Dust Coat", category: "armor", slot: "Chest", rarity_min: "Uncommon", base_level: 9, required_level: 6, width: 2, height: 3, base_stats: { armor: 9, mining: 10, goldFind: 5 }, set_id: "deepvein", glyph: "chest", flavor: "Pockets full of grit.", tags: ["cloth"] },
  { id: "crown_helm", name: "Barbed Crown", category: "armor", slot: "Head", rarity_min: "Legendary", base_level: 40, required_level: 34, width: 2, height: 2, base_stats: { armor: 18, damage: 8, health: 25 }, set_id: "gallowsbrand", glyph: "helm", flavor: "Royalty, inverted.", tags: ["plate"] },
  { id: "thorn_hood", name: "Briar Hood", category: "armor", slot: "Head", rarity_min: "Uncommon", base_level: 7, required_level: 5, width: 2, height: 2, base_stats: { armor: 4, lootChance: 6, critChance: 3 }, set_id: "briarvigil", glyph: "hood", flavor: "Leaves in the stitching.", tags: ["leather"] },
  { id: "grave_hood", name: "Shroud Hood", category: "armor", slot: "Head", rarity_min: "Rare", base_level: 15, required_level: 12, width: 2, height: 2, base_stats: { armor: 6, undeadDamage: 10 }, set_id: "gravetithe", glyph: "hood", flavor: "Borrowed from a quieter owner.", tags: ["cloth"] },
  { id: "plate_greaves", name: "March Greaves", category: "armor", slot: "Legs", rarity_min: "Rare", base_level: 22, required_level: 18, width: 2, height: 3, base_stats: { armor: 16, health: 20 }, set_id: "oathbound", glyph: "legs", flavor: "Knees that refuse to bow.", tags: ["plate"] },
  { id: "night_gloves", name: "Cutpurse Gloves", category: "armor", slot: "Gloves", rarity_min: "Uncommon", base_level: 7, required_level: 5, width: 2, height: 1, base_stats: { armor: 2, goldFind: 6, dodge: 3 }, set_id: "nightmarket", glyph: "gloves", flavor: "Fingertips worn thin.", tags: ["leather"] },
  { id: "howl_boots", name: "Stamped Boots", category: "armor", slot: "Boots", rarity_min: "Rare", base_level: 17, required_level: 14, width: 2, height: 2, base_stats: { armor: 7, damage: 4, attackSpeed: 5 }, set_id: "redhowl", glyph: "boots", flavor: "They want to run toward the fight.", tags: ["leather"] },
  { id: "reliquary_helm", name: "Cinder Helm", category: "armor", slot: "Head", rarity_min: "Epic", base_level: 26, required_level: 22, width: 2, height: 2, base_stats: { armor: 14, fire: 8, health: 16 }, set_id: "emberreliquary", glyph: "helm", flavor: "A grate over a prayer.", tags: ["plate"] },
];

for (const a of moreArmor) add({ ...a, affix_pool: ARM, stackable: 0, max_stack: 1, sell_mult: 1 });

const extraFill: typeof weapons = [
  { id: "rust_mace", name: "Rusted Flail", category: "weapon", slot: "Weapon", rarity_min: "Common", base_level: 6, required_level: 4, width: 2, height: 2, base_stats: { damage: 12, bleed: 3 }, set_id: null, glyph: "mace", flavor: "Tetanus with a chain.", tags: ["mace"] },
  { id: "hunter_knife", name: "Skinner", category: "weapon", slot: "Weapon", rarity_min: "Common", base_level: 3, required_level: 2, width: 1, height: 2, base_stats: { damage: 8, lootChance: 5 }, set_id: "briarvigil", glyph: "knife", flavor: "Knows hide from meat.", tags: ["dagger"] },
  { id: "sledge", name: "Quarry Sledge", category: "weapon", slot: "Weapon", rarity_min: "Uncommon", base_level: 14, required_level: 10, width: 2, height: 3, base_stats: { damage: 22, mining: 8 }, set_id: "deepvein", glyph: "hammer", flavor: "For rock that argues.", tags: ["hammer"] },
  { id: "scythe", name: "Tithe Scythe", category: "weapon", slot: "Weapon", rarity_min: "Rare", base_level: 21, required_level: 16, width: 2, height: 3, base_stats: { damage: 24, bleed: 10, execute: 8 }, set_id: "ironorchard", glyph: "sickle", flavor: "The church's other collector.", tags: ["tool"] },
  { id: "bone_shield", name: "Rib Pavise", category: "armor", slot: "Offhand", rarity_min: "Rare", base_level: 16, required_level: 12, width: 2, height: 3, base_stats: { armor: 12, undeadDamage: 6 }, set_id: "gravetithe", glyph: "shield", flavor: "The dead still useful.", tags: ["shield"] },
  { id: "thorn_bracers", name: "Briar Bracers", category: "armor", slot: "Gloves", rarity_min: "Uncommon", base_level: 9, required_level: 6, width: 2, height: 1, base_stats: { armor: 3, thorns: 6, bleed: 3, critChance: 3 }, set_id: "briarvigil", glyph: "gloves", flavor: "They bite back.", tags: ["leather"] },
  { id: "cult_robes", name: "Ash Vestments", category: "armor", slot: "Chest", rarity_min: "Epic", base_level: 27, required_level: 22, width: 2, height: 3, base_stats: { armor: 10, fire: 10, health: 20 }, set_id: "emberreliquary", glyph: "cloak", flavor: "Embers in the hem.", tags: ["cloth"] },
  { id: "dark_greaves", name: "Night Greaves", category: "armor", slot: "Legs", rarity_min: "Epic", base_level: 25, required_level: 20, width: 2, height: 3, base_stats: { armor: 12, dodge: 8, poison: 4 }, set_id: "silentcowl", glyph: "legs", flavor: "Soft iron, quieter steps.", tags: ["leather"] },
  { id: "king_ring", name: "Hollow Crown Ring", category: "jewelry", slot: "Ring1", rarity_min: "Legendary", base_level: 36, required_level: 30, width: 1, height: 1, base_stats: { damage: 8, goldFind: 10, health: 20 }, set_id: "gallowsbrand", glyph: "ring", flavor: "A kingdom reduced to jewelry.", tags: ["ring"] },
  { id: "myth_amulet", name: "Ashmarch Seal", category: "jewelry", slot: "Neck", rarity_min: "Mythic", base_level: 50, required_level: 42, width: 1, height: 1, base_stats: { health: 40, lootChance: 12, goldFind: 12, damage: 10 }, set_id: "hearthless", glyph: "neck", flavor: "The road itself, waxed and sealed.", tags: ["neck"] },
];

for (const e of extraFill) {
  const pool = e.category === "weapon" ? WEP : e.category === "jewelry" ? JWL : ARM;
  add({ ...e, affix_pool: pool, stackable: 0, max_stack: 1, sell_mult: 1 });
}

const magicArms: typeof weapons = [
  { id: "ash_wand", name: "Ash Wand", category: "weapon", slot: "Weapon", rarity_min: "Common", base_level: 1, required_level: 1, width: 1, height: 2, base_stats: { magicDamage: 8, critChance: 4 }, set_id: null, glyph: "wand", flavor: "A twig that learned to bite.", tags: ["wand", "magic", "fire"] },
  { id: "peat_staff", name: "Peat Staff", category: "weapon", slot: "Weapon", rarity_min: "Uncommon", base_level: 6, required_level: 4, width: 1, height: 4, base_stats: { magicDamage: 12, luck: 4 }, set_id: "hearthless", glyph: "staff", flavor: "Lightning hops the fen.", tags: ["staff", "magic", "chain"] },
  { id: "ember_wand", name: "Cinder Wand", category: "weapon", slot: "Weapon", rarity_min: "Rare", base_level: 16, required_level: 12, width: 1, height: 2, base_stats: { magicDamage: 20, lifesteal: 4 }, set_id: "emberreliquary", glyph: "wand", flavor: "A saint's spark on a stick.", tags: ["wand", "magic", "fire"] },
  { id: "storm_staff", name: "Stormfen Crook", category: "weapon", slot: "Weapon", rarity_min: "Rare", base_level: 18, required_level: 14, width: 1, height: 4, base_stats: { magicDamage: 22, poison: 6, poisonChance: 25 }, set_id: "stormfen", glyph: "staff", flavor: "The marsh leaps from foe to foe.", tags: ["staff", "magic", "chain"] },
  { id: "rime_wand", name: "Rime Wand", category: "weapon", slot: "Weapon", rarity_min: "Uncommon", base_level: 10, required_level: 8, width: 1, height: 2, base_stats: { magicDamage: 14, dodge: 4 }, set_id: "silentcowl", glyph: "wand", flavor: "Cold enough to stop a heart's beat.", tags: ["wand", "magic", "frost"] },
  { id: "cinder_staff", name: "Reliquary Staff", category: "weapon", slot: "Weapon", rarity_min: "Epic", base_level: 28, required_level: 22, width: 1, height: 4, base_stats: { magicDamage: 32, critDamage: 20 }, set_id: "emberreliquary", glyph: "staff", flavor: "Choir-fire, long-handled.", tags: ["staff", "magic", "fire"] },
  { id: "glacier_staff", name: "Barrow Crook", category: "weapon", slot: "Weapon", rarity_min: "Legendary", base_level: 36, required_level: 30, width: 1, height: 4, base_stats: { magicDamage: 40, health: 20 }, set_id: "gravetithe", glyph: "staff", flavor: "Winter that outlived its king.", tags: ["staff", "magic", "frost"] },
];
for (const w of magicArms) add({ ...w, affix_pool: [], stackable: 0, max_stack: 1, sell_mult: 1 });

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
  const magic = d.tags.includes("magic");
  let stats = exclusiveDamage(sanitizeStats(d.base_stats as Record<string, number>), magic);
  if (d.slot) {
    const pad: [StatKey, number][] = magic
      ? [
          ["magicDamage", 8],
          ["critChance", 4],
          ["critDamage", 15],
          ["lifesteal", 3],
          ["luck", 4],
        ]
      : d.category === "weapon"
        ? [
            ["damage", 8],
            ["critChance", 4],
            ["critDamage", 15],
            ["lifesteal", 3],
            ["luck", 4],
          ]
        : d.category === "jewelry"
          ? [
              ["luck", 5],
              ["health", 8],
              ["critChance", 4],
              ["lifesteal", 3],
              ["dodge", 3],
            ]
          : [
              ["armor", 6],
              ["health", 12],
              ["dodge", 3],
              ["regen", 1],
              ["luck", 3],
            ];
    stats = padItemStats(stats, pad);
  }
  d.base_stats = stats;
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
