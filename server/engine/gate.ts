import { db } from "../db.ts";

const KEY = "gate";

export type Gate = {
  version: string;
  maintenance: boolean;
  message: string;
};

export function defaultGate(): Gate {
  return { version: "1.0.0", maintenance: false, message: "" };
}

export function loadGate(): Gate {
  const row = db.prepare("SELECT value FROM world_settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  if (!row?.value) return defaultGate();
  try {
    const raw = JSON.parse(row.value) as Partial<Gate>;
    return {
      version: String(raw.version || "1.0.0").slice(0, 40).trim() || "1.0.0",
      maintenance: !!raw.maintenance,
      message: String(raw.message || "").slice(0, 2000),
    };
  } catch {
    return defaultGate();
  }
}

export function saveGate(raw: unknown): Gate {
  const src = (raw && typeof raw === "object" ? raw : {}) as Partial<Gate>;
  const gate: Gate = {
    version: String(src.version ?? loadGate().version).slice(0, 40).trim() || "1.0.0",
    maintenance: !!src.maintenance,
    message: String(src.message ?? "").slice(0, 2000),
  };
  db.prepare(
    `INSERT INTO world_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(KEY, JSON.stringify(gate));
  return gate;
}

export function publicStatus() {
  const g = loadGate();
  return { version: g.version, maintenance: g.maintenance, message: g.message };
}
