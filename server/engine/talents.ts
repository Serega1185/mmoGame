import { db, now } from "../db.ts";
import { addStats, emptyStats, sanitizeStats } from "./stats.ts";
import { listHeroBases } from "./heroTables.ts";

export type TalentDef = {
  id: string;
  name: string;
  description: string;
  stats: Record<string, number>;
};

/** Legacy omen list — still seeded into `skills` for old rows. */
export const TALENTS: TalentDef[] = [
  { id: "bloodlust", name: "Bloodlust", description: "Each critical hit restores 2% of maximum health.", stats: {} },
  { id: "finisher", name: "Finishing Blow", description: "Deal 20% more damage to foes below 25% health.", stats: {} },
  { id: "berserk", name: "Berserk", description: "For every 10% missing HP, gain +5% damage.", stats: {} },
  { id: "iron_skin", name: "Iron Skin", description: "+15% armor.", stats: {} },
  { id: "veteran", name: "Hardened Veteran", description: "Take 5% less damage while above 80% health.", stats: {} },
  { id: "butcher", name: "Butcher", description: "+5 Bleed.", stats: { bleed: 5 } },
  { id: "poisoner", name: "Poisoner", description: "+5 Poison.", stats: { poison: 5 } },
  { id: "lucky", name: "Lucky", description: "+10% Luck.", stats: { luck: 10 } },
  { id: "heavy_hand", name: "Heavy Hand", description: "+20% physical damage. −10% dodge.", stats: { dodge: -10 } },
  { id: "iron_will", name: "Iron Will", description: "When your armor is fully broken, gain 1 Barrier. Once per fight.", stats: {} },
  { id: "spiked_armor", name: "Spiked Armor", description: "Start each fight with 5 Thorns.", stats: {} },
  { id: "last_bastion", name: "Last Bastion", description: "While below 30% health, gain +20% dodge.", stats: {} },
  { id: "bleeder", name: "Bloodletter", description: "+15% bleed chance.", stats: { bleedChance: 15 } },
  { id: "venom_weapon", name: "Venomous Weapon", description: "+15% poison chance.", stats: { poisonChance: 15 } },
  { id: "arcane_might", name: "Arcane Might", description: "+20% magic damage.", stats: {} },
];

export const TALENT_IDS = TALENTS.map((t) => t.id);

export const TALENT_EFFECTS = [
  { id: "", label: "stats" },
  { id: "bloodlust", label: "bloodlust" },
  { id: "finisher", label: "finisher" },
  { id: "berserk", label: "berserk" },
  { id: "iron_skin", label: "iron_skin" },
  { id: "veteran", label: "veteran" },
  { id: "iron_will", label: "iron_will" },
  { id: "spiked_armor", label: "spiked_armor" },
  { id: "last_bastion", label: "last_bastion" },
  { id: "heavy_hand", label: "heavy_hand" },
  { id: "arcane_might", label: "arcane_might" },
] as const;

export type TalentLane = "left" | "center" | "center_l" | "center_m" | "center_r" | "right";
export type TalentTree = { taken: string[] };

export type TalentNode = {
  id: string;
  heroId: string;
  lane: TalentLane;
  tier: number;
  icon: string;
  effect: string;
  stats: Record<string, number>;
  names: Record<"en" | "ru" | "zh", string>;
  descs: Record<"en" | "ru" | "zh", string>;
};

export const TREE_SLOTS: { lane: TalentLane; tier: number }[] = [
  { lane: "left", tier: 0 },
  { lane: "left", tier: 1 },
  { lane: "left", tier: 2 },
  { lane: "left", tier: 3 },
  { lane: "center", tier: 0 },
  { lane: "center_l", tier: 1 },
  { lane: "center_l", tier: 2 },
  { lane: "center_l", tier: 3 },
  { lane: "center_m", tier: 1 },
  { lane: "center_m", tier: 2 },
  { lane: "center_m", tier: 3 },
  { lane: "center_r", tier: 1 },
  { lane: "center_r", tier: 2 },
  { lane: "center_r", tier: 3 },
  { lane: "right", tier: 0 },
  { lane: "right", tier: 1 },
  { lane: "right", tier: 2 },
  { lane: "right", tier: 3 },
];

const LANGS = ["en", "ru", "zh"] as const;
const LANES = new Set<TalentLane>(["left", "center", "center_l", "center_m", "center_r", "right"]);

export function talentSlotId(heroId: string, lane: TalentLane, tier: number) {
  return `${heroId}:${lane}:${tier}`;
}

export function isRootLane(lane: TalentLane) {
  return lane === "left" || lane === "center" || lane === "right";
}

export function ensureTalentTables() {
  db.exec(
    `CREATE TABLE IF NOT EXISTS talent_defs (
      id TEXT PRIMARY KEY,
      hero_id TEXT NOT NULL,
      lane TEXT NOT NULL,
      tier INTEGER NOT NULL,
      icon TEXT NOT NULL DEFAULT '',
      effect TEXT NOT NULL DEFAULT '',
      stats TEXT NOT NULL DEFAULT '{}',
      UNIQUE (hero_id, lane, tier)
    )`
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS talent_i18n (
      talent_id TEXT NOT NULL REFERENCES talent_defs(id) ON DELETE CASCADE,
      lang TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (talent_id, lang)
    )`
  );
}

function loc(en: string, ru: string, zh: string) {
  return { en, ru, zh };
}

type SeedBit = {
  lane: TalentLane;
  tier: number;
  effect?: string;
  stats?: Record<string, number>;
  icon: string;
  names: { en: string; ru: string; zh: string };
  descs: { en: string; ru: string; zh: string };
};

const ICO = {
  chest: "/assets/64x64/armor/chestgear_04.png",
  helm: "/assets/64x64/armor/headgear_03.png",
  boots: "/assets/64x64/armor/footgear_04.png",
  belt: "/assets/64x64/armor/beltgear_03.png",
  axe: "/assets/64x64/axe/axe_08.png",
  axe2: "/assets/64x64/axe/axe_18.png",
  mace: "/assets/64x64/mace/mace_10.png",
  shield: "/assets/64x64/shield/shield_12.png",
  shield2: "/assets/64x64/shield/shield_20.png",
  bow: "/assets/64x64/rangers/bow_04.png",
  bow2: "/assets/64x64/rangers/bow_08.png",
  wand: "/assets/64x64/mag/Wand/wand_04.png",
  staff: "/assets/64x64/mag/Staff cropless/staff_cropless_05.png",
  scepter: "/assets/64x64/mag/Scepter/scepter_06.png",
  ring: "/assets/64x64/ring/Red/bronze_ring_01_red_gemstone_03.png",
  gem: "/assets/64x64/gemstone_31.png",
};

function seedFor(hero: string): SeedBit[] {
  if (hero === "Shadehand") {
    return [
      { lane: "left", tier: 0, icon: ICO.axe, effect: "finisher", names: loc("Quiet Edge", "Тихая кромка", "静刃"), descs: loc("Deal 20% more damage to foes below 25% health.", "На 20% больше урона врагам ниже 25% здоровья.", "对生命低于 25% 的敌人多造成 20% 伤害。") },
      { lane: "left", tier: 1, icon: ICO.axe2, stats: { critChance: 6 }, names: loc("Night Angle", "Ночной угол", "夜角"), descs: loc("+6% crit chance.", "+6% к шансу крита.", "暴击几率 +6%。") },
      { lane: "left", tier: 2, icon: ICO.mace, stats: { critDamage: 20 }, names: loc("Vein Cut", "Порез вены", "割脉"), descs: loc("+20% crit damage.", "+20% к критическому урону.", "暴击伤害 +20%。") },
      { lane: "left", tier: 3, icon: ICO.axe, effect: "bloodlust", names: loc("Red Sip", "Алый глоток", "赤啜"), descs: loc("Each critical hit restores 2% of maximum health.", "За каждый крит восстанавливает 2% здоровья.", "每次暴击回复最大生命的 2%。") },
      { lane: "center", tier: 0, icon: ICO.wand, stats: { poison: 4 }, names: loc("Green Thumb", "Зелёный палец", "绿指"), descs: loc("+4 Poison.", "Отравление +4.", "中毒 +4。") },
      { lane: "center_l", tier: 1, icon: ICO.scepter, stats: { poison: 6 }, names: loc("Bile Flask", "Фляга желчи", "胆瓶"), descs: loc("+6 Poison.", "Отравление +6.", "中毒 +6。") },
      { lane: "center_l", tier: 2, icon: ICO.gem, stats: { poisonChance: 12 }, names: loc("Wet Steel", "Мокрая сталь", "湿钢"), descs: loc("+12% poison chance.", "+12% к шансу отравления.", "中毒几率 +12%。") },
      { lane: "center_l", tier: 3, icon: ICO.wand, stats: { poison: 8, poisonChance: 8 }, names: loc("Widow Mix", "Смесь вдовы", "寡妇剂"), descs: loc("+8 Poison and +8% poison chance.", "+8 отравления и +8% к шансу.", "中毒 +8，中毒几率 +8%。") },
      { lane: "center_m", tier: 1, icon: ICO.ring, stats: { bleed: 5 }, names: loc("Open Wrist", "Открытое запястье", "开腕"), descs: loc("+5 Bleed.", "Кровотечение +5.", "流血 +5。") },
      { lane: "center_m", tier: 2, icon: ICO.axe2, stats: { bleedChance: 12 }, names: loc("Sawtooth", "Пилозуб", "锯齿"), descs: loc("+12% bleed chance.", "+12% к шансу кровотечения.", "流血几率 +12%。") },
      { lane: "center_m", tier: 3, icon: ICO.mace, stats: { bleed: 8, lifesteal: 4 }, names: loc("Cup of Vein", "Чаша вены", "脉杯"), descs: loc("+8 Bleed and +4% lifesteal.", "+8 кровотечения и +4% вампиризма.", "流血 +8，吸血 +4%。") },
      { lane: "center_r", tier: 1, icon: ICO.gem, stats: { luck: 8 }, names: loc("Loaded Die", "Меченый кубик", "灌铅骰"), descs: loc("+8 Luck.", "+8 к удаче.", "幸运 +8。") },
      { lane: "center_r", tier: 2, icon: ICO.ring, stats: { luck: 8, critChance: 4 }, names: loc("Crooked Seal", "Кривая печать", "歪印"), descs: loc("+8 Luck and +4% crit chance.", "+8 удачи и +4% крита.", "幸运 +8，暴击几率 +4%。") },
      { lane: "center_r", tier: 3, icon: ICO.scepter, stats: { luck: 10, dodge: 4 }, names: loc("Market Ghost", "Рыночный дух", "市鬼"), descs: loc("+10 Luck and +4% dodge.", "+10 удачи и +4% уклонения.", "幸运 +10，闪避 +4%。") },
      { lane: "right", tier: 0, icon: ICO.boots, stats: { dodge: 6 }, names: loc("Soft Step", "Мягкий шаг", "软步"), descs: loc("+6% dodge.", "+6% к уклонению.", "闪避 +6%。") },
      { lane: "right", tier: 1, icon: ICO.belt, stats: { dodge: 6, lifesteal: 3 }, names: loc("Borrowed Breath", "Краденый вздох", "偷息"), descs: loc("+6% dodge and +3% lifesteal.", "+6% уклонения и +3% вампиризма.", "闪避 +6%，吸血 +3%。") },
      { lane: "right", tier: 2, icon: ICO.helm, effect: "last_bastion", names: loc("Last Door", "Последняя дверь", "末门"), descs: loc("While below 30% health, gain +20% dodge.", "Ниже 30% здоровья: +20% уклонения.", "生命低于 30% 时闪避 +20%。") },
      { lane: "right", tier: 3, icon: ICO.boots, stats: { dodge: 8, critChance: 5 }, names: loc("Empty Coat", "Пустой плащ", "空袍"), descs: loc("+8% dodge and +5% crit chance.", "+8% уклонения и +5% крита.", "闪避 +8%，暴击几率 +5%。") },
    ];
  }
  if (hero === "Thornbow") {
    return [
      { lane: "left", tier: 0, icon: ICO.bow, stats: { damage: 6 }, names: loc("Long Pull", "Длинная тяга", "长拉"), descs: loc("+6 physical damage.", "+6 к физическому урону.", "物理伤害 +6。") },
      { lane: "left", tier: 1, icon: ICO.bow2, stats: { critChance: 7 }, names: loc("True Notch", "Верная зарубка", "准槽"), descs: loc("+7% crit chance.", "+7% к шансу крита.", "暴击几率 +7%。") },
      { lane: "left", tier: 2, icon: ICO.bow, effect: "finisher", names: loc("Last Shaft", "Последний древко", "末矢"), descs: loc("Deal 20% more damage to foes below 25% health.", "На 20% больше урона врагам ниже 25% здоровья.", "对生命低于 25% 的敌人多造成 20% 伤害。") },
      { lane: "left", tier: 3, icon: ICO.bow2, stats: { critDamage: 25 }, names: loc("Heartwood", "Сердцевина", "心材"), descs: loc("+25% crit damage.", "+25% к критическому урону.", "暴击伤害 +25%。") },
      { lane: "center", tier: 0, icon: ICO.staff, stats: { thorns: 4 }, names: loc("Briar String", "Терновая тетива", "棘弦"), descs: loc("+4 Thorns.", "+4 шипов.", "荆棘 +4。") },
      { lane: "center_l", tier: 1, icon: ICO.wand, stats: { poison: 5 }, names: loc("Sap Tip", "Смоляной наконечник", "脂尖"), descs: loc("+5 Poison.", "Отравление +5.", "中毒 +5。") },
      { lane: "center_l", tier: 2, icon: ICO.scepter, stats: { poisonChance: 14 }, names: loc("Green Rain", "Зелёный дождь", "绿雨"), descs: loc("+14% poison chance.", "+14% к шансу отравления.", "中毒几率 +14%。") },
      { lane: "center_l", tier: 3, icon: ICO.staff, stats: { poison: 8, thorns: 4 }, names: loc("Hedge Saint", "Святой изгороди", "篱圣"), descs: loc("+8 Poison and +4 Thorns.", "+8 отравления и +4 шипов.", "中毒 +8，荆棘 +4。") },
      { lane: "center_m", tier: 1, icon: ICO.chest, stats: { health: 20 }, names: loc("Root Stance", "Стойка корня", "根姿"), descs: loc("+20 health.", "+20 здоровья.", "生命 +20。") },
      { lane: "center_m", tier: 2, icon: ICO.shield, effect: "spiked_armor", names: loc("Thorn Coat", "Шипастый кафтан", "刺袍"), descs: loc("Start each fight with 5 Thorns.", "В начале боя +5 шипов.", "每场战斗开始时获得 5 点荆棘。") },
      { lane: "center_m", tier: 3, icon: ICO.chest, stats: { health: 30, regen: 3 }, names: loc("Living Hedge", "Живая изгородь", "活篱"), descs: loc("+30 health and +3 regen.", "+30 здоровья и +3 регена.", "生命 +30，回复 +3。") },
      { lane: "center_r", tier: 1, icon: ICO.gem, effect: "arcane_might", names: loc("Stormfen Draw", "Натяг Штормфена", "沼拉"), descs: loc("+20% magic damage.", "+20% магического урона.", "魔法伤害 +20%。") },
      { lane: "center_r", tier: 2, icon: ICO.wand, stats: { magicDamage: 8 }, names: loc("Wet Spark", "Мокрая искра", "湿火"), descs: loc("+8 magic damage.", "+8 магического урона.", "魔法伤害 +8。") },
      { lane: "center_r", tier: 3, icon: ICO.scepter, stats: { magicDamage: 10, luck: 6 }, names: loc("Bell Arrow", "Стрела-колокол", "钟矢"), descs: loc("+10 magic damage and +6 Luck.", "+10 магии и +6 удачи.", "魔法伤害 +10，幸运 +6。") },
      { lane: "right", tier: 0, icon: ICO.boots, stats: { dodge: 5 }, names: loc("Brush Step", "Шаг в кустах", "丛步"), descs: loc("+5% dodge.", "+5% к уклонению.", "闪避 +5%。") },
      { lane: "right", tier: 1, icon: ICO.belt, stats: { luck: 6 }, names: loc("Trail Mark", "Метка тропы", "径记"), descs: loc("+6 Luck.", "+6 к удаче.", "幸运 +6。") },
      { lane: "right", tier: 2, icon: ICO.helm, stats: { dodge: 6, luck: 6 }, names: loc("Hood of Leaves", "Капюшон листьев", "叶兜"), descs: loc("+6% dodge and +6 Luck.", "+6% уклонения и +6 удачи.", "闪避 +6%，幸运 +6。") },
      { lane: "right", tier: 3, icon: ICO.bow2, stats: { dodge: 8, damage: 6 }, names: loc("Gone Before", "Уже ушёл", "先走"), descs: loc("+8% dodge and +6 physical damage.", "+8% уклонения и +6 урона.", "闪避 +8%，物理伤害 +6。") },
    ];
  }
  return [
    { lane: "left", tier: 0, icon: ICO.shield, effect: "iron_skin", names: loc("Iron Hide", "Железная шкура", "铁皮"), descs: loc("+15% armor.", "+15% к броне.", "护甲 +15%。") },
    { lane: "left", tier: 1, icon: ICO.chest, stats: { armor: 8 }, names: loc("Thick Rivets", "Толстые заклёпки", "厚铆"), descs: loc("+8 armor.", "+8 к броне.", "护甲 +8。") },
    { lane: "left", tier: 2, icon: ICO.shield2, effect: "spiked_armor", names: loc("Nail Wall", "Стена гвоздей", "钉墙"), descs: loc("Start each fight with 5 Thorns.", "В начале боя +5 шипов.", "每场战斗开始时获得 5 点荆棘。") },
    { lane: "left", tier: 3, icon: ICO.chest, effect: "veteran", names: loc("Hard March", "Тяжёлый марш", "硬行"), descs: loc("Take 5% less damage while above 80% health.", "На 5% меньше урона при здоровье выше 80%.", "生命高于 80% 时受到的伤害降低 5%。") },
    { lane: "center", tier: 0, icon: ICO.axe, effect: "heavy_hand", names: loc("Heavy Hand", "Тяжёлая рука", "重手"), descs: loc("+20% physical damage. −10% dodge.", "+20% к физическому урону. −10% к уклонению.", "物理伤害 +20%。闪避 −10%。") },
    { lane: "center_l", tier: 1, icon: ICO.axe2, stats: { bleed: 5 }, names: loc("Cleaver", "Тесак", "砍刀"), descs: loc("+5 Bleed.", "Кровотечение +5.", "流血 +5。") },
    { lane: "center_l", tier: 2, icon: ICO.mace, stats: { bleedChance: 12 }, names: loc("Open Seam", "Открытый шов", "开缝"), descs: loc("+12% bleed chance.", "+12% к шансу кровотечения.", "流血几率 +12%。") },
    { lane: "center_l", tier: 3, icon: ICO.axe, effect: "finisher", names: loc("Last Tax", "Последний налог", "末税"), descs: loc("Deal 20% more damage to foes below 25% health.", "На 20% больше урона врагам ниже 25% здоровья.", "对生命低于 25% 的敌人多造成 20% 伤害。") },
    { lane: "center_m", tier: 1, icon: ICO.mace, effect: "berserk", names: loc("Red Fog", "Алый туман", "赤雾"), descs: loc("For every 10% missing HP, gain +5% damage.", "За каждые потерянные 10% HP — +5% урона.", "每缺失 10% 生命，伤害 +5%。") },
    { lane: "center_m", tier: 2, icon: ICO.axe2, stats: { damage: 8 }, names: loc("Wider Arc", "Шире дуга", "阔弧"), descs: loc("+8 physical damage.", "+8 к физическому урону.", "物理伤害 +8。") },
    { lane: "center_m", tier: 3, icon: ICO.mace, effect: "bloodlust", names: loc("Warm Work", "Тёплая работа", "热活"), descs: loc("Each critical hit restores 2% of maximum health.", "За каждый крит восстанавливает 2% здоровья.", "每次暴击回复最大生命的 2%。") },
    { lane: "center_r", tier: 1, icon: ICO.helm, stats: { health: 25 }, names: loc("Deep Chest", "Глубокая грудь", "深胸"), descs: loc("+25 health.", "+25 здоровья.", "生命 +25。") },
    { lane: "center_r", tier: 2, icon: ICO.belt, stats: { regen: 4 }, names: loc("Slow Blood", "Медленная кровь", "慢血"), descs: loc("+4 regen.", "+4 регена.", "回复 +4。") },
    { lane: "center_r", tier: 3, icon: ICO.chest, stats: { health: 35, armor: 6 }, names: loc("Keep Walking", "Иди дальше", "接着走"), descs: loc("+35 health and +6 armor.", "+35 здоровья и +6 брони.", "生命 +35，护甲 +6。") },
    { lane: "right", tier: 0, icon: ICO.helm, stats: { health: 20 }, names: loc("Thick Skull", "Толстый череп", "厚颅"), descs: loc("+20 health.", "+20 здоровья.", "生命 +20。") },
    { lane: "right", tier: 1, icon: ICO.boots, stats: { armor: 6, health: 15 }, names: loc("Planted Boot", "Вросший сапог", "钉靴"), descs: loc("+6 armor and +15 health.", "+6 брони и +15 здоровья.", "护甲 +6，生命 +15。") },
    { lane: "right", tier: 2, icon: ICO.shield, effect: "iron_will", names: loc("Iron Will", "Железная воля", "铁意"), descs: loc("When your armor is fully broken, gain 1 Barrier. Once per fight.", "Когда броня сбита — 1 барьер. Один раз за бой.", "护甲被彻底打穿时获得 1 层护盾。每场战斗一次。") },
    { lane: "right", tier: 3, icon: ICO.shield2, effect: "last_bastion", names: loc("Last Bastion", "Последний бастион", "末垒"), descs: loc("While below 30% health, gain +20% dodge.", "Ниже 30% здоровья: +20% уклонения.", "生命低于 30% 时闪避 +20%。") },
  ];
}

function upsertSkillRow(id: string, name: string, description: string, stats: Record<string, number>) {
  db.prepare(
    `INSERT INTO skills (id, name, description, stats) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, stats=excluded.stats`
  ).run(id, name, description, JSON.stringify(stats));
}

export function seedTalents() {
  ensureTalentTables();
  const ins = db.prepare(
    `INSERT INTO talent_defs (id, hero_id, lane, tier, icon, effect, stats)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  );
  const locIns = db.prepare(
    `INSERT INTO talent_i18n (talent_id, lang, name, description) VALUES (?, ?, ?, ?)
     ON CONFLICT(talent_id, lang) DO NOTHING`
  );
  const heroes = listHeroBases();
  const ids = heroes.length ? heroes.map((h) => h.id) : ["Ironclad", "Shadehand", "Thornbow"];
  for (const heroId of ids) {
    const n = (db.prepare("SELECT COUNT(*) AS c FROM talent_defs WHERE hero_id=?").get(heroId) as { c: number }).c;
    if (n > 0) continue;
    for (const bit of seedFor(heroId)) {
      const id = talentSlotId(heroId, bit.lane, bit.tier);
      const stats = sanitizeStats(bit.stats || {});
      ins.run(id, heroId, bit.lane, bit.tier, bit.icon, bit.effect || "", JSON.stringify(stats));
      upsertSkillRow(id, bit.names.en, bit.descs.en, stats);
      for (const lang of LANGS) locIns.run(id, lang, bit.names[lang], bit.descs[lang]);
    }
  }
}

function emptyLoc() {
  return { en: "", ru: "", zh: "" };
}

function localesForTalent(id: string): { names: TalentNode["names"]; descs: TalentNode["descs"] } {
  const names = emptyLoc();
  const descs = emptyLoc();
  const rows = db.prepare("SELECT lang, name, description FROM talent_i18n WHERE talent_id=?").all(id) as {
    lang: string;
    name: string;
    description: string;
  }[];
  for (const row of rows) {
    if (row.lang === "en" || row.lang === "ru" || row.lang === "zh") {
      names[row.lang] = row.name;
      descs[row.lang] = row.description || "";
    }
  }
  return { names, descs };
}

function parseStats(raw: string): Record<string, number> {
  try {
    return sanitizeStats(JSON.parse(raw || "{}") as Record<string, number>);
  } catch {
    return {};
  }
}

export function loadHeroTalents(heroId: string): TalentNode[] {
  seedTalents();
  const rows = db
    .prepare("SELECT id, hero_id, lane, tier, icon, effect, stats FROM talent_defs WHERE hero_id=?")
    .all(heroId) as {
    id: string;
    hero_id: string;
    lane: string;
    tier: number;
    icon: string;
    effect: string;
    stats: string;
  }[];
  return rows
    .filter((r) => LANES.has(r.lane as TalentLane))
    .map((r) => {
      const i18n = localesForTalent(r.id);
      return {
        id: r.id,
        heroId: r.hero_id,
        lane: r.lane as TalentLane,
        tier: r.tier,
        icon: r.icon || "",
        effect: r.effect || "",
        stats: parseStats(r.stats),
        names: i18n.names,
        descs: i18n.descs,
      };
    });
}

export function isTalentId(id: string) {
  if (!id) return false;
  if (TALENT_IDS.includes(id)) return true;
  return !!db.prepare("SELECT id FROM talent_defs WHERE id=?").get(id);
}

export function loadPickedTalents(characterId: string): string[] {
  const rows = db
    .prepare("SELECT skill_id FROM character_skills WHERE character_id = ?")
    .all(characterId) as { skill_id: string }[];
  return rows.map((r) => r.skill_id).filter(isTalentId);
}

export function loadPickedEffects(characterId: string): { ids: string[]; effects: string[]; stats: Record<string, number> } {
  const rows = db
    .prepare(
      `SELECT cs.skill_id, td.effect, td.stats AS tstats, s.stats AS sstats
       FROM character_skills cs
       LEFT JOIN talent_defs td ON td.id = cs.skill_id
       LEFT JOIN skills s ON s.id = cs.skill_id
       WHERE cs.character_id = ?`
    )
    .all(characterId) as { skill_id: string; effect: string | null; tstats: string | null; sstats: string | null }[];
  const ids: string[] = [];
  const effects: string[] = [];
  let stats = emptyStats();
  for (const row of rows) {
    ids.push(row.skill_id);
    const effect = String(row.effect || row.skill_id);
    if (effect) effects.push(effect);
    stats = addStats(stats, parseStats(row.tstats || row.sstats || "{}"));
  }
  return { ids, effects, stats };
}

export function freshTalentTree(): TalentTree {
  return { taken: [] };
}

export function parseTalentTree(raw: unknown): TalentTree | null {
  try {
    const t = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!t || typeof t !== "object") return null;
    if (Array.isArray((t as TalentTree).taken) && !("rows" in (t as object))) {
      return { taken: (t as TalentTree).taken.map(String) };
    }
    return null;
  } catch {
    return null;
  }
}

export function ensureTalentTree(characterId: string, raw: unknown, heroId?: string): TalentTree {
  seedTalents();
  const existing = parseTalentTree(raw);
  if (existing) {
    const allowed = new Set(heroId ? loadHeroTalents(heroId).map((n) => n.id) : []);
    const taken = heroId ? existing.taken.filter((id) => allowed.has(id)) : existing.taken;
    if (taken.length !== existing.taken.length) {
      const next = { taken };
      db.prepare("UPDATE characters SET talent_tree = ? WHERE id = ?").run(JSON.stringify(next), characterId);
      return next;
    }
    return existing;
  }
  db.prepare("DELETE FROM character_skills WHERE character_id = ?").run(characterId);
  const tree = freshTalentTree();
  db.prepare("UPDATE characters SET talent_tree = ?, talent_points = COALESCE(talent_points, 0) WHERE id = ?").run(
    JSON.stringify(tree),
    characterId
  );
  return tree;
}

function nodeAt(nodes: TalentNode[], lane: TalentLane, tier: number) {
  return nodes.find((n) => n.lane === lane && n.tier === tier) || null;
}

function takenSet(tree: TalentTree) {
  return new Set(tree.taken);
}

export function committedLane(tree: TalentTree, nodes: TalentNode[]): TalentLane | null {
  const have = takenSet(tree);
  const root = nodes.find((n) => n.tier === 0 && isRootLane(n.lane) && have.has(n.id));
  return root?.lane || null;
}

export function committedFork(tree: TalentTree, nodes: TalentNode[]): TalentLane | null {
  const have = takenSet(tree);
  const fork = nodes.find((n) => n.tier === 1 && n.lane.startsWith("center_") && have.has(n.id));
  return fork?.lane || null;
}

export function canPickTalent(tree: TalentTree, talentId: string, nodes: TalentNode[]) {
  const node = nodes.find((n) => n.id === talentId);
  if (!node || tree.taken.includes(talentId)) return false;
  const have = takenSet(tree);
  const commit = committedLane(tree, nodes);
  if (!commit) return node.tier === 0 && isRootLane(node.lane);
  if (commit === "left" || commit === "right") {
    if (node.lane !== commit) return false;
    const prev = nodeAt(nodes, node.lane, node.tier - 1);
    return !!prev && have.has(prev.id);
  }
  if (node.lane === "left" || node.lane === "right" || node.lane === "center") return false;
  const fork = committedFork(tree, nodes);
  if (!fork) return node.tier === 1 && node.lane.startsWith("center_");
  if (node.lane !== fork) return false;
  const prev = nodeAt(nodes, node.lane, node.tier - 1);
  return !!prev && have.has(prev.id);
}

export function applyTalentPick(characterId: string, tree: TalentTree, talentId: string, nodes: TalentNode[]): TalentTree {
  const next: TalentTree = { taken: [...tree.taken, talentId] };
  const node = nodes.find((n) => n.id === talentId);
  if (node) upsertSkillRow(node.id, node.names.en || node.id, node.descs.en || "", node.stats);
  db.prepare("INSERT INTO character_skills (character_id, skill_id, picked_at) VALUES (?, ?, ?)").run(
    characterId,
    talentId,
    now()
  );
  db.prepare("UPDATE characters SET talent_tree = ?, talent_points = MAX(0, talent_points - 1) WHERE id = ?").run(
    JSON.stringify(next),
    characterId
  );
  return next;
}

export function publicTalentTree(heroId: string, tree: TalentTree) {
  return {
    taken: tree.taken,
    nodes: loadHeroTalents(heroId).map((n) => ({
      id: n.id,
      lane: n.lane,
      tier: n.tier,
      icon: n.icon,
      effect: n.effect,
      stats: n.stats,
      names: n.names,
      descs: n.descs,
    })),
  };
}

function cleanIcon(raw: unknown) {
  const icon = String(raw ?? "").trim().slice(0, 240);
  if (!icon) return "";
  return icon.startsWith("/assets/") || icon.startsWith("http") ? icon : "";
}

export function adminListTalents(heroId?: string) {
  seedTalents();
  const heroes = listHeroBases().map((h) => h.id);
  const id = String(heroId || heroes[0] || "Ironclad");
  return {
    heroId: id,
    heroes,
    effects: TALENT_EFFECTS.map((e) => e.id),
    slots: TREE_SLOTS,
    nodes: loadHeroTalents(id),
  };
}

export function adminSaveTalent(raw: Record<string, unknown>) {
  seedTalents();
  const heroId = String(raw.heroId || raw.hero_id || "").trim();
  const lane = String(raw.lane || "").trim() as TalentLane;
  const tier = Math.trunc(Number(raw.tier));
  if (!heroId || !LANES.has(lane)) return { error: "Unknown talent slot." as const };
  if (!Number.isFinite(tier) || tier < 0 || tier > 3) return { error: "Unknown talent slot." as const };
  if (lane === "center" && tier !== 0) return { error: "Unknown talent slot." as const };
  if (lane.startsWith("center_") && tier < 1) return { error: "Unknown talent slot." as const };
  const id = talentSlotId(heroId, lane, tier);
  const stats = sanitizeStats((raw.stats && typeof raw.stats === "object" ? raw.stats : {}) as Record<string, number>);
  const effect = TALENT_EFFECTS.some((e) => e.id === String(raw.effect || "")) ? String(raw.effect || "") : "";
  const icon = cleanIcon(raw.icon);
  const namesIn = (raw.names && typeof raw.names === "object" ? raw.names : {}) as Record<string, string>;
  const descsIn = (raw.descs && typeof raw.descs === "object" ? raw.descs : {}) as Record<string, string>;
  db.prepare(
    `INSERT INTO talent_defs (id, hero_id, lane, tier, icon, effect, stats)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET icon=excluded.icon, effect=excluded.effect, stats=excluded.stats`
  ).run(id, heroId, lane, tier, icon, effect, JSON.stringify(stats));
  const locUp = db.prepare(
    `INSERT INTO talent_i18n (talent_id, lang, name, description) VALUES (?, ?, ?, ?)
     ON CONFLICT(talent_id, lang) DO UPDATE SET name=excluded.name, description=excluded.description`
  );
  for (const lang of LANGS) {
    const name = String(namesIn[lang] || namesIn.en || namesIn.ru || id).trim().slice(0, 48) || id;
    const description = String(descsIn[lang] || descsIn.en || "").trim().slice(0, 280);
    locUp.run(id, lang, name, description);
  }
  const enName = String(namesIn.en || namesIn.ru || id);
  upsertSkillRow(id, enName, String(descsIn.en || descsIn.ru || ""), stats);
  return { error: null as null, id };
}

export function adminDeleteTalent(heroId: string, lane: string, tier: number) {
  const L = String(lane) as TalentLane;
  if (!LANES.has(L)) return { error: "Unknown talent slot." as const };
  const id = talentSlotId(String(heroId), L, Math.trunc(tier));
  db.prepare("DELETE FROM character_skills WHERE skill_id=?").run(id);
  db.prepare("DELETE FROM talent_i18n WHERE talent_id=?").run(id);
  db.prepare("DELETE FROM talent_defs WHERE id=?").run(id);
  return { error: null as null, id };
}
