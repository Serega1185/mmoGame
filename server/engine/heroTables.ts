import { db } from "../db.ts";
import { CLASS_BASE } from "./stats.ts";

const LANGS = ["en", "ru", "zh"] as const;
export type CatalogLang = (typeof LANGS)[number];

export type HeroBase = {
  id: string;
  sort: number;
  health: number;
  damage: number;
  armor: number;
  critChance: number;
  critDamage: number;
  dodge: number;
  lifesteal: number;
  luck: number;
  magicDamage: number;
  icon: string;
  portrait: string;
  starters: string[];
};

type HeroLocale = { name: string; blurb: string };
export type HeroCatalog = Record<string, Record<CatalogLang, HeroLocale>>;

const SEED: {
  id: string;
  sort: number;
  health: number;
  damage: number;
  armor: number;
  critChance: number;
  critDamage: number;
  dodge: number;
  lifesteal: number;
  luck: number;
  magicDamage: number;
  names: Record<CatalogLang, HeroLocale>;
}[] = [
  {
    id: "Ironclad",
    sort: 1,
    health: CLASS_BASE.Ironclad.health,
    damage: CLASS_BASE.Ironclad.damage,
    armor: CLASS_BASE.Ironclad.armor,
    critChance: CLASS_BASE.Ironclad.critChance,
    critDamage: CLASS_BASE.Ironclad.critDamage,
    dodge: CLASS_BASE.Ironclad.dodge,
    lifesteal: CLASS_BASE.Ironclad.lifesteal,
    luck: 0,
    magicDamage: 0,
    names: {
      en: { name: "Ironclad", blurb: "Thick hide, heavier steel. Armor and endurance." },
      ru: { name: "Железношкурый", blurb: "Толстая шкура, тяжёлая сталь. Броня и выносливость." },
      zh: { name: "铁甲卫", blurb: "厚皮重钢。护甲与耐力。" },
    },
  },
  {
    id: "Shadehand",
    sort: 2,
    health: CLASS_BASE.Shadehand.health,
    damage: CLASS_BASE.Shadehand.damage,
    armor: CLASS_BASE.Shadehand.armor,
    critChance: CLASS_BASE.Shadehand.critChance,
    critDamage: CLASS_BASE.Shadehand.critDamage,
    dodge: CLASS_BASE.Shadehand.dodge,
    lifesteal: CLASS_BASE.Shadehand.lifesteal,
    luck: 0,
    magicDamage: 0,
    names: {
      en: { name: "Shadehand", blurb: "Quiet knives, stolen breaths. Crit, dodge, leech." },
      ru: { name: "Тенерук", blurb: "Тихие ножи, краденые вздохи. Крит, уклонение, вампиризм." },
      zh: { name: "影手", blurb: "静刃与偷息。暴击、闪避、吸血。" },
    },
  },
  {
    id: "Thornbow",
    sort: 3,
    health: CLASS_BASE.Thornbow.health,
    damage: CLASS_BASE.Thornbow.damage,
    armor: CLASS_BASE.Thornbow.armor,
    critChance: CLASS_BASE.Thornbow.critChance,
    critDamage: CLASS_BASE.Thornbow.critDamage,
    dodge: CLASS_BASE.Thornbow.dodge,
    lifesteal: CLASS_BASE.Thornbow.lifesteal,
    luck: 0,
    magicDamage: 0,
    names: {
      en: { name: "Thornbow", blurb: "The hedge keeps its own. Loot, gold, and keen shots." },
      ru: { name: "Терновый Лук", blurb: "Изгородь бережёт своих. Добыча, золото и меткий выстрел." },
      zh: { name: "荆棘弓", blurb: "篱笆护己。战利、金币与准射。" },
    },
  },
  {
    id: "Ashpriest",
    sort: 4,
    health: 95,
    damage: 8,
    armor: 3,
    critChance: 6,
    critDamage: 150,
    dodge: 5,
    lifesteal: 0,
    luck: 4,
    magicDamage: 14,
    names: {
      en: { name: "Ashpriest", blurb: "Cinder rites. Magic, dregs of life, and a slow mend." },
      ru: { name: "Пепельный жрец", blurb: "Обряды золы. Магия, остатки жизни и медленное исцеление." },
      zh: { name: "灰烬祭司", blurb: "烬礼。魔力、残息与缓愈。" },
    },
  },
  {
    id: "Warden",
    sort: 5,
    health: 125,
    damage: 13,
    armor: 6,
    critChance: 7,
    critDamage: 155,
    dodge: 5,
    lifesteal: 2,
    luck: 0,
    magicDamage: 0,
    names: {
      en: { name: "Warden", blurb: "A middle road. Steady steel and a stubborn heart." },
      ru: { name: "Страж", blurb: "Средняя дорога. Верная сталь и упрямое сердце." },
      zh: { name: "守望者", blurb: "中道。稳钢与顽心。" },
    },
  },
];

export function ensureHeroTables() {
  db.exec(
    `CREATE TABLE IF NOT EXISTS hero_defs (
      id TEXT PRIMARY KEY,
      sort INTEGER NOT NULL DEFAULT 0,
      health INTEGER NOT NULL,
      damage INTEGER NOT NULL,
      armor INTEGER NOT NULL,
      crit_chance REAL NOT NULL,
      crit_damage REAL NOT NULL,
      dodge REAL NOT NULL,
      lifesteal REAL NOT NULL DEFAULT 0,
      luck REAL NOT NULL DEFAULT 0,
      magic_damage INTEGER NOT NULL DEFAULT 0,
      pass TEXT NOT NULL DEFAULT '{}',
      icon TEXT NOT NULL DEFAULT '',
      portrait TEXT NOT NULL DEFAULT '',
      starters TEXT NOT NULL DEFAULT '[]'
    )`
  );
  try {
    db.exec("ALTER TABLE hero_defs ADD COLUMN starters TEXT NOT NULL DEFAULT '[]'");
  } catch {
    /* already present */
  }
  try {
    db.exec("ALTER TABLE hero_defs ADD COLUMN portrait TEXT NOT NULL DEFAULT ''");
  } catch {
    /* already present */
  }
  db.prepare("UPDATE hero_defs SET pass = '{}'").run();
  db.exec(
    `CREATE TABLE IF NOT EXISTS hero_i18n (
      hero_id TEXT NOT NULL REFERENCES hero_defs(id) ON DELETE CASCADE,
      lang TEXT NOT NULL,
      name TEXT NOT NULL,
      blurb TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (hero_id, lang)
    )`
  );
}

export function seedHeroes() {
  ensureHeroTables();
  const ins = db.prepare(
    `INSERT INTO hero_defs (id,sort,health,damage,armor,crit_chance,crit_damage,dodge,lifesteal,luck,magic_damage,pass,icon)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO NOTHING`
  );
  const loc = db.prepare(
    `INSERT INTO hero_i18n (hero_id, lang, name, blurb) VALUES (?, ?, ?, ?)
     ON CONFLICT(hero_id, lang) DO NOTHING`
  );
  for (const h of SEED) {
    ins.run(h.id, h.sort, h.health, h.damage, h.armor, h.critChance, h.critDamage, h.dodge, h.lifesteal, h.luck, h.magicDamage, "{}", "");
    for (const lang of LANGS) loc.run(h.id, lang, h.names[lang].name, h.names[lang].blurb);
  }
}

function parseStarters(raw: string) {
  try {
    const o = JSON.parse(raw || "[]");
    if (!Array.isArray(o)) return [];
    return [...new Set(o.map((x) => String(x || "").trim()).filter(Boolean))].slice(0, 16);
  } catch {
    return [];
  }
}

export function loadHeroBase(id: string): HeroBase | null {
  const row = db.prepare("SELECT * FROM hero_defs WHERE id=?").get(id) as
    | {
        id: string;
        sort: number;
        health: number;
        damage: number;
        armor: number;
        crit_chance: number;
        crit_damage: number;
        dodge: number;
        lifesteal: number;
        luck: number;
        magic_damage: number;
        icon: string;
        portrait?: string;
        starters?: string;
      }
    | undefined;
  if (!row) {
    const fb = CLASS_BASE[id as keyof typeof CLASS_BASE];
    if (!fb) return null;
    return {
      id,
      sort: 0,
      health: fb.health,
      damage: fb.damage,
      armor: fb.armor,
      critChance: fb.critChance,
      critDamage: fb.critDamage,
      dodge: fb.dodge,
      lifesteal: fb.lifesteal,
      luck: 0,
      magicDamage: 0,
      icon: "",
      portrait: "",
      starters: [],
    };
  }
  return {
    id: row.id,
    sort: row.sort,
    health: row.health,
    damage: row.damage,
    armor: row.armor,
    critChance: row.crit_chance,
    critDamage: row.crit_damage,
    dodge: row.dodge,
    lifesteal: row.lifesteal,
    luck: row.luck,
    magicDamage: row.magic_damage,
    icon: row.icon || "",
    portrait: row.portrait || "",
    starters: parseStarters(row.starters || "[]"),
  };
}

function cleanAsset(raw: unknown, fallback: string) {
  const icon = String(raw ?? fallback ?? "").trim().slice(0, 240);
  return !icon || icon.startsWith("/assets/") || icon.startsWith("http") ? icon : fallback;
}

export function listHeroBases(): HeroBase[] {
  seedHeroes();
  return (db.prepare("SELECT id FROM hero_defs ORDER BY sort, id").all() as { id: string }[])
    .map((r) => loadHeroBase(r.id))
    .filter((h): h is HeroBase => !!h);
}

export function localesForHero(id: string): Record<CatalogLang, HeroLocale> {
  const empty = { name: id, blurb: "" };
  const out: Record<CatalogLang, HeroLocale> = { en: { ...empty }, ru: { ...empty }, zh: { ...empty } };
  const rows = db.prepare("SELECT lang, name, blurb FROM hero_i18n WHERE hero_id=?").all(id) as {
    lang: string;
    name: string;
    blurb: string;
  }[];
  for (const row of rows) {
    if (row.lang === "en" || row.lang === "ru" || row.lang === "zh") {
      out[row.lang] = { name: row.name, blurb: row.blurb || "" };
    }
  }
  return out;
}

export function loadHeroCatalog(): HeroCatalog {
  const out: HeroCatalog = {};
  for (const h of listHeroBases()) out[h.id] = localesForHero(h.id);
  return out;
}

export function publicHeroes() {
  return listHeroBases().map((h) => ({
    ...h,
    i18n: localesForHero(h.id),
  }));
}

export function saveHeroI18n(id: string, names: Record<string, string>, blurbs: Record<string, string>) {
  const up = db.prepare(
    `INSERT INTO hero_i18n (hero_id, lang, name, blurb) VALUES (?, ?, ?, ?)
     ON CONFLICT(hero_id, lang) DO UPDATE SET name=excluded.name, blurb=excluded.blurb`
  );
  for (const lang of LANGS) {
    const name = String(names[lang] || names.en || names.ru || id).trim().slice(0, 40);
    const blurb = String(blurbs[lang] || blurbs.en || "").trim().slice(0, 200);
    if (!name) continue;
    up.run(id, lang, name, blurb);
  }
}

export function adminSaveHero(raw: Record<string, unknown>) {
  const id = String(raw.id || "").trim();
  const cur = loadHeroBase(id);
  if (!cur) return { error: "No such calling." as const };
  const n = (k: string, d: number) => {
    const v = Number(raw[k]);
    return Number.isFinite(v) ? v : d;
  };
  const icon = cleanAsset(raw.icon, cur.icon);
  const portrait = cleanAsset(raw.portrait, cur.portrait);
  const startersIn = Array.isArray(raw.starters) ? raw.starters : cur.starters;
  const starters = parseStarters(JSON.stringify(startersIn)).filter((defId) =>
    !!(db.prepare("SELECT id FROM item_definitions WHERE id=?").get(defId))
  );
  db.prepare(
    `UPDATE hero_defs SET health=?, damage=?, armor=?, crit_chance=?, crit_damage=?, dodge=?, lifesteal=?, luck=?, magic_damage=?, pass=?, icon=?, portrait=?, starters=?
     WHERE id=?`
  ).run(
    Math.max(20, Math.trunc(n("health", cur.health))),
    Math.max(0, Math.trunc(n("damage", cur.damage))),
    Math.max(0, Math.trunc(n("armor", cur.armor))),
    Math.max(0, n("critChance", cur.critChance)),
    Math.max(100, n("critDamage", cur.critDamage)),
    Math.max(0, n("dodge", cur.dodge)),
    Math.max(0, n("lifesteal", cur.lifesteal)),
    Math.max(0, n("luck", cur.luck)),
    Math.max(0, Math.trunc(n("magicDamage", cur.magicDamage))),
    "{}",
    icon,
    portrait,
    JSON.stringify(starters),
    id
  );
  const names = (raw.names && typeof raw.names === "object" ? raw.names : {}) as Record<string, string>;
  const blurbs = (raw.blurbs && typeof raw.blurbs === "object" ? raw.blurbs : {}) as Record<string, string>;
  if (Object.keys(names).length) saveHeroI18n(id, names, blurbs);
  return { error: null, id };
}
