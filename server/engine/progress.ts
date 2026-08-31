import { db } from "../db.ts";

const KEY = "kill_xp";

export type XpKind = "normal" | "elite" | "boss";
export type XpConfig = Record<XpKind, number> & { depthMul: number };

export function defaultXpConfig(): XpConfig {
  return { normal: 1, elite: 2, boss: 3, depthMul: 1 };
}

export function normalizeXpConfig(raw: unknown): XpConfig {
  const fb = defaultXpConfig();
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const clampInt = (v: unknown, fallback: number) => {
    const n = Math.trunc(Number(v));
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.min(9999, n);
  };
  const clampMul = (v: unknown, fallback: number) => {
    const n = Math.round(Number(v) * 1000) / 1000;
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.min(100, n);
  };
  return {
    normal: clampInt(src.normal, fb.normal),
    elite: clampInt(src.elite, fb.elite),
    boss: clampInt(src.boss, fb.boss),
    depthMul: clampMul(src.depthMul, fb.depthMul),
  };
}

export function loadXpConfig(): XpConfig {
  const row = db.prepare("SELECT value FROM world_settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  if (!row?.value) return defaultXpConfig();
  try {
    return normalizeXpConfig(JSON.parse(row.value));
  } catch {
    return defaultXpConfig();
  }
}

export function saveXpConfig(raw: unknown): XpConfig {
  const cfg = normalizeXpConfig(raw);
  db.prepare(
    `INSERT INTO world_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(KEY, JSON.stringify(cfg));
  return cfg;
}

export function xpToNext(level: number) {
  return Math.max(1, Math.trunc(Number(level) || 1));
}

export function xpForFight(depth: number, kind: string, cfg = loadXpConfig()) {
  const d = Math.max(1, Math.trunc(Number(depth) || 1));
  const k: XpKind = kind === "boss" || kind === "elite" ? kind : "normal";
  return Math.max(0, Math.round(cfg[k] * (d * cfg.depthMul)));
}
