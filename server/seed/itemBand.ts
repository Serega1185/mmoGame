import { RARITIES, RARITY_MULT, STATS_PER_RARITY, roundStat, sanitizeStats, type StatKey, type Stats } from "../engine/stats.ts";

export type ItemLocalePack = Record<"en" | "ru" | "zh", [string, string]>;
type BandSeed = {
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
  affix_pool: { key: StatKey; min: number; max: number }[];
  set_id: string | null;
  glyph: string;
  flavor: string;
  tags: string[];
  sell_mult: number;
};

export const ITEM_LOCALES: Record<string, ItemLocalePack> = {};

const SLOTS = ["Head", "Chest", "Gloves", "Legs", "Boots", "Weapon", "Offhand", "Neck", "Ring1", "Ring2"] as const;
type Slot = (typeof SLOTS)[number];

const BAND_A: Slot[] = ["Head", "Chest", "Weapon"];
const BAND_B: Slot[] = ["Gloves", "Legs", "Boots"];
const BAND_C: Slot[] = ["Offhand", "Neck", "Ring1"];
const BANDS = [BAND_A, BAND_B, BAND_C];
const NOSET_ODD: Slot[] = ["Ring2", "Head", "Gloves"];
const NOSET_EVEN: Slot[] = ["Offhand", "Neck", "Ring1"];
const SET_FINISH: Slot[][] = [BAND_B, BAND_A, ["Ring2", "Gloves", "Weapon"]];

const MAX_LEVEL = 20;

const SLOT_WORD: Record<Slot, ItemLocalePack> = {
  Head: { en: ["Helm", "Iron for the brow."], ru: ["Шлем", "Железо на лоб."], zh: ["盔", "额上的铁。"] },
  Chest: { en: ["Cuirass", "A wall you wear."], ru: ["Кираса", "Стена, которую носят."], zh: ["胸甲", "穿在身上的墙。"] },
  Gloves: { en: ["Gauntlets", "Fists that remember work."], ru: ["Рукавицы", "Кулаки, помнящие работу."], zh: ["护手", "记得劳作的拳。"] },
  Legs: { en: ["Greaves", "Knees that refuse the mud."], ru: ["Поножи", "Колени, что не кланяются грязи."], zh: ["护胫", "不肯跪泥的膝。"] },
  Boots: { en: ["Boots", "The road starts here."], ru: ["Сапоги", "Дорога начинается здесь."], zh: ["靴", "路从这里开始。"] },
  Weapon: { en: ["Blade", "An argument of steel."], ru: ["Клинок", "Довод из стали."], zh: ["刃", "钢的争辩。"] },
  Offhand: { en: ["Guard", "The other hand answers."], ru: ["Страж", "Другая рука отвечает."], zh: ["护具", "另一只手作答。"] },
  Neck: { en: ["Torque", "A vow at the throat."], ru: ["Гривна", "Обет у горла."], zh: ["项圈", "喉上的誓。"] },
  Ring1: { en: ["Signet", "A house reduced to a circle."], ru: ["Перстень", "Дом, сжатый в круг."], zh: ["印戒", "缩成环的家。"] },
  Ring2: { en: ["Band", "Metal that learned a name."], ru: ["Кольцо", "Металл, выучивший имя."], zh: ["环", "学会名字的金属。"] },
};

const GLYPH: Record<Slot, string> = {
  Head: "helm",
  Chest: "chest",
  Gloves: "gloves",
  Legs: "legs",
  Boots: "boots",
  Weapon: "sword",
  Offhand: "shield",
  Neck: "neck",
  Ring1: "ring",
  Ring2: "ring",
};

const SET_LOCALE: Record<string, ItemLocalePack> = {
  oathbound: { en: ["Oathbound", "Vows hammered into steel."], ru: ["Клятвы", "Обеты, вбитые в сталь."], zh: ["誓约", "锤进钢里的誓。"] },
  redhowl: { en: ["Howl", "Blood answers blood."], ru: ["Воя", "Кровь отвечает крови."], zh: ["嚎", "血应答血。"] },
  briarvigil: { en: ["Briar", "Thorns keep the road."], ru: ["Терна", "Шипы стерегут дорогу."], zh: ["荆棘", "刺守路。"] },
  silentcowl: { en: ["Cowl", "A breath, then a grave."], ru: ["Куколя", "Вдох — и могила."], zh: ["罩", "一息，然后坟。"] },
  emberreliquary: { en: ["Ember", "Holy fire in a locked casket."], ru: ["Угля", "Святой огонь в ларце."], zh: ["烬", "锁匣中的圣火。"] },
  gallowsbrand: { en: ["Gallows", "Sentence first, steel second."], ru: ["Эшафота", "Сначала приговор."], zh: ["绞架", "先判决，后钢。"] },
  deepvein: { en: ["Deepvein", "Ore remembers the miner."], ru: ["Жилы", "Руда помнит рудокопа."], zh: ["深脉", "矿石记得矿工。"] },
  anvilcovenant: { en: ["Anvil", "Every blow is a prayer."], ru: ["Наковальни", "Каждый удар — молитва."], zh: ["砧", "每一击都是祈祷。"] },
  crimsonthirst: { en: ["Thirst", "The night drinks first."], ru: ["Жажды", "Ночь пьёт первой."], zh: ["渴", "夜先饮。"] },
  censerwoe: { en: ["Woe", "Mercy smells of vinegar and ash."], ru: ["Скорби", "Милосердие пахнет пеплом."], zh: ["哀", "怜悯似醋与灰。"] },
  gravetithe: { en: ["Tithe", "The dead pay in iron."], ru: ["Десятины", "Мёртвые платят железом."], zh: ["赋", "死者以铁纳税。"] },
  hearthless: { en: ["Hearthless", "No roof. Only road."], ru: ["Без очага", "Нет крыши. Только дорога."], zh: ["无灶", "没有屋顶。只有路。"] },
  ironorchard: { en: ["Orchard", "Harvest is a kind of war."], ru: ["Сада", "Жатва — тоже война."], zh: ["园", "收获也是战争。"] },
  nightmarket: { en: ["Market", "Everything has a price in the dark."], ru: ["Рынка", "В темноте у всего есть цена."], zh: ["市", "暗中万物有价。"] },
  stormfen: { en: ["Fen", "The marsh keeps secrets, and teeth."], ru: ["Топи", "Топь хранит тайны и зубы."], zh: ["沼", "沼泽藏秘密与牙。"] },
};

const PLAIN: ItemLocalePack = {
  en: ["Wayfarer", "Steel for whoever walks."],
  ru: ["Путника", "Сталь для того, кто идёт."],
  zh: ["行路", "给走路人的钢。"],
};

function statLines(slot: Slot, level: number): [StatKey, number][] {
  const n = 1 + (level - 1) * 0.35;
  if (slot === "Weapon") {
    return [
      ["damage", Math.round(7 * n)],
      ["critChance", 4],
      ["critDamage", 15],
      ["lifesteal", 3],
      ["luck", 4],
      ["armor", 3],
    ];
  }
  if (slot === "Offhand") {
    return [
      ["armor", Math.round(5 * n)],
      ["health", Math.round(8 * n)],
      ["thorns", 2],
      ["barrier", 1],
      ["dodge", 2],
      ["regen", 1],
    ];
  }
  if (slot === "Neck" || slot === "Ring1" || slot === "Ring2") {
    return [
      ["luck", 4],
      ["health", Math.round(7 * n)],
      ["critChance", 3],
      ["lifesteal", 3],
      ["dodge", 3],
      ["regen", 1],
    ];
  }
  return [
    ["armor", Math.round(5 * n)],
    ["health", Math.round(10 * n)],
    ["dodge", 2],
    ["regen", 1],
    ["luck", 3],
    ["thorns", 2],
  ];
}

function rarityMap(slot: Slot, level: number): Record<string, Stats> {
  const lines = statLines(slot, level);
  const out: Record<string, Stats> = {};
  for (const r of RARITIES) {
    const take = STATS_PER_RARITY[r] || 1;
    const row: Stats = {};
    for (const [k, v] of lines.slice(0, take)) {
      row[k] = roundStat(k, v * RARITY_MULT[r]);
    }
    out[r] = sanitizeStats(row);
  }
  return out;
}

function title(setId: string | null, slot: Slot): ItemLocalePack {
  const word = SLOT_WORD[slot];
  const who = setId ? SET_LOCALE[setId] || PLAIN : PLAIN;
  return {
    en: [`${who.en[0]} ${word.en[0]}`, who.en[1]],
    ru: [`${word.ru[0]} ${who.ru[0]}`, who.ru[1]],
    zh: [`${who.zh[0]}${word.zh[0]}`, who.zh[1]],
  };
}

function categoryOf(slot: Slot) {
  if (slot === "Weapon") return "weapon";
  if (slot === "Neck" || slot === "Ring1" || slot === "Ring2") return "jewelry";
  return "armor";
}

function makeItem(id: string, level: number, slot: Slot, setId: string | null, flavor: string): BandSeed {
  const names = title(setId, slot);
  ITEM_LOCALES[id] = names;
  return {
    id,
    name: names.en[0],
    category: categoryOf(slot),
    slot,
    rarity_min: "Common",
    base_level: level,
    required_level: level,
    width: 1,
    height: 1,
    stackable: 0,
    max_stack: 1,
    base_stats: rarityMap(slot, level) as unknown as Record<string, number>,
    affix_pool: [],
    set_id: setId,
    glyph: GLYPH[slot],
    flavor: flavor || names.en[1],
    tags: [],
    sell_mult: 1,
  };
}

export function generateBandItems(sets: { id: string; flavor: string }[]): BandSeed[] {
  const setIds = sets.map((s) => s.id);
  const flavorOf = new Map(sets.map((s) => [s.id, s.flavor]));
  const out: BandSeed[] = [];
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const pair = Math.floor((level - 1) / 2);
    const intro = pair * 3;
    const trio = [0, 1, 2].map((i) => setIds[(intro + i) % setIds.length]!);
    const odd = level % 2 === 1;
    const rot = pair % 3;
    const bands = [0, 1, 2].map((i) => (odd ? BANDS[(i + rot) % 3]! : SET_FINISH[(i + rot) % 3]!));
    trio.forEach((setId, i) => {
      for (const slot of bands[i]!) {
        out.push(makeItem(`l${level}_${setId}_${slot.toLowerCase()}`, level, slot, setId, flavorOf.get(setId) || ""));
      }
    });
    const plain = odd ? NOSET_ODD : NOSET_EVEN;
    for (const slot of plain) {
      out.push(makeItem(`l${level}_plain_${slot.toLowerCase()}`, level, slot, null, PLAIN.en[1]));
    }
  }
  return out;
}
