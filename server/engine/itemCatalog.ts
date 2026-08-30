import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../db.ts";
import { ITEMS } from "../../src/i18n/lore.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
export const ICON_DIR = path.join(root, "data", "item-icons");
const STOCK_DIR = path.join(root, "assets", "64x64");
const LANGS = ["en", "ru", "zh"] as const;
export type CatalogLang = (typeof LANGS)[number];

export type ItemLocale = { name: string; flavor: string };
export type ItemCatalog = Record<string, Record<CatalogLang, ItemLocale>>;

fs.mkdirSync(ICON_DIR, { recursive: true });

export function ensureItemCatalogTables() {
  db.exec(
    `CREATE TABLE IF NOT EXISTS item_i18n (
      definition_id TEXT NOT NULL REFERENCES item_definitions(id) ON DELETE CASCADE,
      lang TEXT NOT NULL,
      name TEXT NOT NULL,
      flavor TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (definition_id, lang)
    )`
  );
  try {
    db.exec("ALTER TABLE item_definitions ADD COLUMN icon TEXT NOT NULL DEFAULT ''");
  } catch {
    /* already present */
  }
}

export function seedItemI18n() {
  const ins = db.prepare(
    `INSERT INTO item_i18n (definition_id, lang, name, flavor) VALUES (?, ?, ?, ?)
     ON CONFLICT(definition_id, lang) DO NOTHING`
  );
  const defs = db.prepare("SELECT id, name, flavor FROM item_definitions").all() as {
    id: string;
    name: string;
    flavor: string;
  }[];
  for (const d of defs) {
    const pack = ITEMS[d.id];
    for (const lang of LANGS) {
      const pair = pack?.[lang];
      ins.run(d.id, lang, pair?.[0] || d.name, pair?.[1] || d.flavor || "");
    }
  }
}

export function loadItemCatalog(): ItemCatalog {
  const out: ItemCatalog = {};
  const defs = db.prepare("SELECT id, name, flavor FROM item_definitions").all() as {
    id: string;
    name: string;
    flavor: string;
  }[];
  for (const d of defs) {
    const empty = { name: d.name, flavor: d.flavor || "" };
    out[d.id] = { en: { ...empty }, ru: { ...empty }, zh: { ...empty } };
  }
  const rows = db.prepare("SELECT definition_id, lang, name, flavor FROM item_i18n").all() as {
    definition_id: string;
    lang: string;
    name: string;
    flavor: string;
  }[];
  for (const row of rows) {
    if (!out[row.definition_id]) continue;
    if (row.lang === "en" || row.lang === "ru" || row.lang === "zh") {
      out[row.definition_id]![row.lang] = { name: row.name, flavor: row.flavor || "" };
    }
  }
  return out;
}

export function saveItemI18n(id: string, names: Record<string, string>, flavors: Record<string, string>) {
  const up = db.prepare(
    `INSERT INTO item_i18n (definition_id, lang, name, flavor) VALUES (?, ?, ?, ?)
     ON CONFLICT(definition_id, lang) DO UPDATE SET name=excluded.name, flavor=excluded.flavor`
  );
  for (const lang of LANGS) {
    const name = String(names[lang] || names.en || names.ru || names.zh || "").trim().slice(0, 80);
    const flavor = String(flavors[lang] || "").trim().slice(0, 240);
    if (!name) continue;
    up.run(id, lang, name, flavor);
  }
}

export function localesFor(id: string): Record<CatalogLang, ItemLocale> {
  const cat = loadItemCatalog();
  return (
    cat[id] || {
      en: { name: id, flavor: "" },
      ru: { name: id, flavor: "" },
      zh: { name: id, flavor: "" },
    }
  );
}

function walkPng(dir: string, urlPrefix: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(png|webp|jpg|jpeg|svg)$/i.test(f))
    .map((f) => `${urlPrefix}/${f}`.replace(/\\/g, "/"));
}

function walkImages(dir: string, urlPrefix: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...walkImages(full, `${urlPrefix}/${name}`));
    } else if (/\.(png|webp|jpg|jpeg|svg)$/i.test(name)) {
      out.push(`${urlPrefix}/${name}`.replace(/\\/g, "/"));
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function listItemIcons(): string[] {
  const stock = walkPng(STOCK_DIR, "/assets/64x64");
  const custom = walkPng(ICON_DIR, "/assets/custom");
  return [...stock, ...custom];
}

export function listAssetIcons(rel: "pers" | "mob"): string[] {
  const dir = path.join(root, "assets", rel);
  fs.mkdirSync(dir, { recursive: true });
  return walkImages(dir, `/assets/${rel}`);
}

export function saveUploadedIcon(dataUrl: string): { error?: string; path?: string } {
  return writeUploadedImage(dataUrl, ICON_DIR, "/assets/custom");
}

export function saveUploadedAsset(dataUrl: string, rel: "pers" | "mob"): { error?: string; path?: string } {
  const dir = path.join(root, "assets", rel);
  fs.mkdirSync(dir, { recursive: true });
  return writeUploadedImage(dataUrl, dir, `/assets/${rel}`);
}

function writeUploadedImage(dataUrl: string, dir: string, urlPrefix: string): { error?: string; path?: string } {
  const m = String(dataUrl || "").match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) return { error: "That is not an image." };
  const ext = m[1]!.toLowerCase() === "jpeg" || m[1]!.toLowerCase() === "jpg" ? "jpg" : m[1]!.toLowerCase();
  const buf = Buffer.from(m[2]!.replace(/\s/g, ""), "base64");
  if (buf.length < 32 || buf.length > 2_000_000) return { error: "The image is too large." };
  const name = `i_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  fs.writeFileSync(path.join(dir, name), buf);
  return { path: `${urlPrefix}/${name}` };
}

export function normalizeIcon(raw: unknown): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s.startsWith("/assets/") || s.startsWith("http://") || s.startsWith("https://")) return s.slice(0, 240);
  if (/^[a-zA-Z0-9._-]+\.(png|webp|jpg|jpeg|svg)$/i.test(s)) return `/assets/64x64/${s}`;
  return "";
}
