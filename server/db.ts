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
  db.exec("ALTER TABLE characters ADD COLUMN depth INTEGER NOT NULL DEFAULT 0");
} catch {
  /* already present */
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

export function now() {
  return Date.now();
}

export function tx<T>(fn: () => T): T {
  return db.transaction(fn)();
}
