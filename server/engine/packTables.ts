import { db } from "../db.ts";

const KEY = "pack_odds";

export type PackBand = { minDepth: number; two: number; three: number };
export type PackConfig = { bands: PackBand[] };

export function defaultPackConfig(): PackConfig {
  return { bands: [{ minDepth: 0, two: 10, three: 1 }] };
}

export function normalizePackConfig(raw: unknown): PackConfig {
  const fallback = defaultPackConfig();
  const bandsIn = Array.isArray((raw as PackConfig)?.bands) ? (raw as PackConfig).bands : fallback.bands;
  const seen = new Set<number>();
  const bands: PackBand[] = [];
  for (const b of bandsIn) {
    const minDepth = Math.max(0, Math.trunc(Number(b?.minDepth)));
    if (!Number.isFinite(minDepth) || seen.has(minDepth)) continue;
    seen.add(minDepth);
    const two = Math.min(100, Math.max(0, Number(b?.two)));
    const three = Math.min(100, Math.max(0, Number(b?.three)));
    bands.push({
      minDepth,
      two: Number.isFinite(two) ? two : 0,
      three: Number.isFinite(three) ? three : 0,
    });
  }
  if (!bands.length) return fallback;
  bands.sort((a, c) => a.minDepth - c.minDepth);
  if (bands[0]!.minDepth !== 0) bands[0]!.minDepth = 0;
  return { bands };
}

export function loadPackConfig(): PackConfig {
  const row = db.prepare("SELECT value FROM world_settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  if (!row?.value) return defaultPackConfig();
  try {
    return normalizePackConfig(JSON.parse(row.value));
  } catch {
    return defaultPackConfig();
  }
}

export function savePackConfig(raw: unknown): PackConfig {
  const cfg = normalizePackConfig(raw);
  db.prepare(
    `INSERT INTO world_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(KEY, JSON.stringify(cfg));
  return cfg;
}

export function packOddsFor(depth: number, cfg = loadPackConfig()): { two: number; three: number } {
  const d = Math.max(0, Math.trunc(Number(depth) || 0));
  let pick = cfg.bands[0]!;
  for (const b of cfg.bands) {
    if (b.minDepth <= d) pick = b;
    else break;
  }
  return { two: pick.two, three: pick.three };
}

/** Extra foes besides the first: 0, 1, or 2. */
export function rollPackExtra(depth: number, cfg = loadPackConfig()): number {
  const { two, three } = packOddsFor(depth, cfg);
  const r = Math.random() * 100;
  if (r < three) return 2;
  if (r < three + two) return 1;
  return 0;
}
