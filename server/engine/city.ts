import { db, now } from "../db.ts";
import { parkedMapsFor, roadIsOpen } from "./mapTables.ts";
import { loadGate } from "./gate.ts";

export const CITY_DEFAULT_TAX = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CityRow = {
  depth: number;
  name: string;
  level: number;
  treasury: number;
  tax_percent: number;
  shop_level: number;
  owner_user_id: string | null;
  shop_restock_at: number | null;
};

export function hubDepthOf(character: Record<string, unknown>) {
  const h = Number(character.hub_depth);
  if (Number.isFinite(h) && h >= 1) return Math.trunc(h);
  return Math.max(1, Math.trunc(Number(character.depth) || 1));
}

export function unlockedCityMax(character: Record<string, unknown>, highestRegion: number) {
  const unlocked = Math.max(1, Math.trunc(Number(character.depth) || 1), Math.trunc(highestRegion) || 0);
  return Math.min(unlocked, loadGate().maxDepth);
}

export function ensureCity(depth: number): CityRow {
  const d = Math.max(1, Math.trunc(depth));
  let row = db.prepare("SELECT * FROM cities WHERE depth=?").get(d) as CityRow | undefined;
  if (!row) {
    const region = db.prepare("SELECT name FROM regions WHERE id=?").get(d) as { name: string } | undefined;
    db.prepare(
      "INSERT INTO cities (depth, name, level, treasury, tax_percent, shop_level, owner_user_id) VALUES (?,?,1,0,?,1,NULL)"
    ).run(d, region?.name || `Depth ${d}`, CITY_DEFAULT_TAX);
    row = db.prepare("SELECT * FROM cities WHERE depth=?").get(d) as CityRow;
  }
  return row;
}

export function recordCityVisit(characterId: string, depth: number) {
  const d = Math.max(1, Math.trunc(depth));
  ensureCity(d);
  db.prepare(
    `INSERT INTO city_visits (character_id, city_depth, visited_at) VALUES (?,?,?)
     ON CONFLICT(character_id, city_depth) DO UPDATE SET visited_at=excluded.visited_at`
  ).run(characterId, d, now());
}

export function cityActivity(depth: number) {
  const since = now() - DAY_MS;
  const r = db.prepare("SELECT COUNT(*) AS c FROM city_visits WHERE city_depth=? AND visited_at>=?").get(depth, since) as {
    c: number;
  };
  return r.c;
}

export function cityNameFor(depth: number) {
  const city = db.prepare("SELECT name FROM cities WHERE depth=?").get(depth) as { name: string } | undefined;
  if (city?.name) return city.name;
  const region = db.prepare("SELECT name FROM regions WHERE id=?").get(depth) as { name: string } | undefined;
  return region?.name || `Depth ${depth}`;
}

export function publicCity(character: Record<string, unknown>) {
  const depth = hubDepthOf(character);
  const city = ensureCity(depth);
  recordCityVisit(String(character.id), depth);
  const owner = city.owner_user_id
    ? (db.prepare("SELECT username FROM users WHERE id=?").get(city.owner_user_id) as { username: string } | undefined)
    : undefined;
  const user = db.prepare("SELECT highest_region FROM users WHERE id=?").get(character.user_id) as { highest_region: number };
  const maxD = unlockedCityMax(character, user.highest_region);
  const parked = parkedMapsFor(String(character.id));
  const refreshByDepth = new Map(parked.map((m) => [m.depth, m.refresh_at]));
  const t = now();
  const unlocked: { depth: number; name: string; refreshAt: number | null }[] = [];
  for (let d = 1; d <= maxD; d++) {
    const at = refreshByDepth.get(d) ?? null;
    unlocked.push({ depth: d, name: cityNameFor(d), refreshAt: at && at > t ? at : null });
  }
  const cap = loadGate().maxDepth;
  const here = Math.max(1, Number(character.depth) || depth);
  return {
    depth,
    name: city.name,
    level: city.level,
    treasury: city.treasury,
    taxPercent: city.tax_percent,
    shopLevel: city.shop_level,
    ownerName: owner?.username ?? null,
    activity: cityActivity(depth),
    art: "/assets/art/gorod1.jpg",
    unlocked,
    roadOpen: roadIsOpen(String(character.id), here),
    maxDepth: cap,
    depthCapped: here >= cap,
  };
}

export function addCityTax(depth: number, amount: number) {
  if (amount <= 0) return;
  ensureCity(depth);
  db.prepare("UPDATE cities SET treasury = treasury + ? WHERE depth=?").run(amount, depth);
}
