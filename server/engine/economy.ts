import { v4 as uuid } from "uuid";
import { db, now } from "../db.ts";

export function recordTx(userId: string, type: string, amount: number, source: string, meta?: unknown) {
  db.prepare(
    "INSERT INTO transactions (id, user_id, type, amount, source, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(uuid(), userId, type, amount, source, meta ? JSON.stringify(meta) : null, now());
}

export function addCoins(userId: string, amount: number, type: string, source: string, meta?: unknown) {
  db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").run(amount, userId);
  recordTx(userId, type, amount, source, meta);
}

export function spendCoins(userId: string, amount: number, type: string, source: string, meta?: unknown) {
  const u = db.prepare("SELECT coins FROM users WHERE id = ?").get(userId) as { coins: number };
  if (!u || u.coins < amount) return false;
  db.prepare("UPDATE users SET coins = coins - ? WHERE id = ?").run(amount, userId);
  recordTx(userId, type, -amount, source, meta);
  return true;
}

export function logGame(kind: string, detail: string, userId?: string) {
  db.prepare("INSERT INTO game_logs (id, user_id, kind, detail, created_at) VALUES (?, ?, ?, ?, ?)").run(
    uuid(),
    userId || null,
    kind,
    detail,
    now()
  );
}
