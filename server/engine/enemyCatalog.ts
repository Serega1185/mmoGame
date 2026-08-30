import { db } from "../db.ts";
import { ENEMIES } from "../../src/i18n/lore.ts";

const LANGS = ["en", "ru", "zh"] as const;
export type CatalogLang = (typeof LANGS)[number];
export type EnemyCatalog = Record<string, Record<CatalogLang, string>>;

export function ensureEnemyCatalogTables() {
  db.exec(
    `CREATE TABLE IF NOT EXISTS enemy_i18n (
      enemy_id TEXT NOT NULL REFERENCES enemies(id) ON DELETE CASCADE,
      lang TEXT NOT NULL,
      name TEXT NOT NULL,
      PRIMARY KEY (enemy_id, lang)
    )`
  );
}

export function seedEnemyI18n() {
  ensureEnemyCatalogTables();
  const ins = db.prepare(
    `INSERT INTO enemy_i18n (enemy_id, lang, name) VALUES (?, ?, ?)
     ON CONFLICT(enemy_id, lang) DO NOTHING`
  );
  const rows = db.prepare("SELECT id, name FROM enemies").all() as { id: string; name: string }[];
  for (const row of rows) {
    const pack = ENEMIES[row.id];
    for (const lang of LANGS) {
      ins.run(row.id, lang, pack?.[lang] || row.name);
    }
  }
}

export function loadEnemyCatalog(): EnemyCatalog {
  const out: EnemyCatalog = {};
  const defs = db.prepare("SELECT id, name FROM enemies").all() as { id: string; name: string }[];
  for (const d of defs) {
    out[d.id] = { en: d.name, ru: d.name, zh: d.name };
  }
  const rows = db.prepare("SELECT enemy_id, lang, name FROM enemy_i18n").all() as {
    enemy_id: string;
    lang: string;
    name: string;
  }[];
  for (const row of rows) {
    if (!out[row.enemy_id]) continue;
    if (row.lang === "en" || row.lang === "ru" || row.lang === "zh") {
      out[row.enemy_id]![row.lang] = row.name;
    }
  }
  return out;
}

export function localesForEnemy(id: string): Record<CatalogLang, string> {
  const cat = loadEnemyCatalog();
  return cat[id] || { en: id, ru: id, zh: id };
}

export function saveEnemyI18n(id: string, names: Record<string, string>) {
  const up = db.prepare(
    `INSERT INTO enemy_i18n (enemy_id, lang, name) VALUES (?, ?, ?)
     ON CONFLICT(enemy_id, lang) DO UPDATE SET name=excluded.name`
  );
  for (const lang of LANGS) {
    const name = String(names[lang] || names.en || names.ru || names.zh || "")
      .trim()
      .slice(0, 80);
    if (!name) continue;
    up.run(id, lang, name);
  }
}
