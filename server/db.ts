import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "ashmarch.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
db.exec(schema);
try {
  db.exec("ALTER TABLE characters ADD COLUMN skill_offers TEXT");
} catch {
  /* already present */
}
try {
  db.exec("ALTER TABLE characters ADD COLUMN loot_pending TEXT");
} catch {
  /* already present */
}
try {
  db.exec("ALTER TABLE characters ADD COLUMN talent_points INTEGER NOT NULL DEFAULT 0");
} catch {
  /* already present */
}
try {
  db.exec("ALTER TABLE characters ADD COLUMN talent_tree TEXT");
} catch {
  /* already present */
}
try {
  db.exec("ALTER TABLE characters ADD COLUMN depth INTEGER NOT NULL DEFAULT 1");
} catch {
  /* already present */
}
try {
  db.exec("UPDATE characters SET depth = 1 WHERE depth IS NULL OR depth < 1");
} catch {
  /* ignore */
}
try {
  db.exec("ALTER TABLE characters ADD COLUMN map_state TEXT");
} catch {
  /* already present */
}
try {
  db.exec("CREATE TABLE IF NOT EXISTS world_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
} catch {
  /* already present */
}

try {
  db.exec("ALTER TABLE item_definitions ADD COLUMN icon TEXT NOT NULL DEFAULT ''");
} catch {
  /* already present */
}
try {
  db.exec("ALTER TABLE characters ADD COLUMN hub_depth INTEGER NOT NULL DEFAULT 1");
} catch {
  /* already present */
}
try {
  db.exec(
    `CREATE TABLE IF NOT EXISTS cities (
      depth INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      treasury INTEGER NOT NULL DEFAULT 0,
      tax_percent INTEGER NOT NULL DEFAULT 5,
      shop_level INTEGER NOT NULL DEFAULT 1,
      owner_user_id TEXT REFERENCES users(id)
    )`
  );
} catch {
  /* ignore */
}
try {
  db.exec("ALTER TABLE cities ADD COLUMN shop_restock_at INTEGER");
} catch {
  /* already present */
}
try {
  db.exec(
    `CREATE TABLE IF NOT EXISTS city_shop_items (
      id TEXT PRIMARY KEY,
      city_depth INTEGER NOT NULL,
      instance_id TEXT NOT NULL,
      price INTEGER NOT NULL,
      slot INTEGER NOT NULL,
      generated_at INTEGER NOT NULL
    )`
  );
} catch {
  /* ignore */
}
try {
  db.exec(
    `CREATE TABLE IF NOT EXISTS city_visits (
      character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      city_depth INTEGER NOT NULL,
      visited_at INTEGER NOT NULL,
      PRIMARY KEY (character_id, city_depth)
    )`
  );
} catch {
  /* ignore */
}
try {
  db.exec(
    `CREATE TABLE IF NOT EXISTS item_i18n (
      definition_id TEXT NOT NULL REFERENCES item_definitions(id) ON DELETE CASCADE,
      lang TEXT NOT NULL,
      name TEXT NOT NULL,
      flavor TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (definition_id, lang)
    )`
  );
} catch {
  /* ignore */
}

export function now() {
  return Date.now();
}

export function tx<T>(fn: () => T): T {
  return db.transaction(fn)();
}
