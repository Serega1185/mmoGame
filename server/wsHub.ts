import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, Server } from "node:http";
import jwt from "jsonwebtoken";
import { CONFIG } from "./config.ts";
import { db, now } from "./db.ts";
import { newId, type AuthUser } from "./auth.ts";
import * as game from "./game.ts";

type Client = { ws: WebSocket; user: AuthUser };

const clients = new Set<Client>();

export function broadcast(msg: unknown, pred?: (c: Client) => boolean) {
  const data = JSON.stringify(msg);
  for (const c of clients) {
    if (pred && !pred(c)) continue;
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
  }
}

function parseCookie(header?: string) {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const p of header.split(";")) {
    const [k, ...rest] = p.trim().split("=");
    if (k) out[k] = rest.join("=");
  }
  return out;
}

export function attachWs(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws, req: IncomingMessage) => {
    const cookies = parseCookie(req.headers.cookie);
    let user: AuthUser | null = null;
    try {
      user = jwt.verify(cookies.ashmarch || "", CONFIG.JWT_SECRET) as AuthUser;
    } catch {
      ws.close();
      return;
    }
    const client: Client = { ws, user };
    clients.add(client);
    db.prepare("UPDATE users SET last_seen=? WHERE id=?").run(now(), user.id);
    ws.send(JSON.stringify({ type: "hello", online: [...clients].map((c) => c.user.username) }));
    broadcast({ type: "presence", username: user.username, online: true });

    ws.on("message", (raw) => {
      let msg: { type?: string; channel?: string; body?: string; to?: string };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === "ping") {
        db.prepare("UPDATE users SET last_seen=? WHERE id=?").run(now(), user!.id);
        return;
      }
      if (msg.type === "chat") {
        const u = db.prepare("SELECT muted_until, guild_id FROM users WHERE id=?").get(user!.id) as {
          muted_until: number | null;
          guild_id: string | null;
        };
        if (u.muted_until && u.muted_until > Date.now()) {
          ws.send(JSON.stringify({ type: "error", error: "Your tongue is bound." }));
          return;
        }
        const body = String(msg.body || "").slice(0, 400);
        if (!body.trim()) return;
        if (!body.includes("ITEM_LINK:") && /\[Legendary .+?\+9{2,}/i.test(body)) {
          ws.send(JSON.stringify({ type: "error", error: "Seals, not boasts. Link a true item." }));
          return;
        }
        const channel = msg.channel || "GLOBAL";
        const { character } = game.requireAlive(user!.id);
        const id = newId();
        const created = now();
        if (channel === "PRIVATE" && msg.to) {
          const blocked = db
            .prepare("SELECT 1 FROM chat_blocks WHERE user_id=? AND blocked_user_id=?")
            .get(msg.to, user!.id);
          if (blocked) return;
          db.prepare(
            "INSERT INTO private_messages (id, from_user_id, to_user_id, body, created_at) VALUES (?,?,?,?,?)"
          ).run(id, user!.id, msg.to, body, created);
          const payload = {
            type: "chat",
            channel: "PRIVATE",
            id,
            user_id: user!.id,
            username: user!.username,
            body,
            created_at: created,
            to: msg.to,
          };
          broadcast(payload, (c) => c.user.id === user!.id || c.user.id === msg.to);
          return;
        }
        let region: number | null = null;
        let guildId: string | null = null;
        if (channel === "REGION") {
          if (!character) return;
          region = Number(character.region);
        }
        if (channel === "GUILD") {
          if (!u.guild_id) return;
          guildId = u.guild_id;
        }
        const ch = channel === "GUILD" ? "GUILD" : channel === "REGION" ? "REGION" : "GLOBAL";
        db.prepare(
          "INSERT INTO chat_messages (id, channel, region, guild_id, user_id, username, body, created_at) VALUES (?,?,?,?,?,?,?,?)"
        ).run(id, ch, region, guildId, user!.id, user!.username, body, created);
        const payload = {
          type: "chat",
          channel: ch,
          id,
          user_id: user!.id,
          username: user!.username,
          body,
          created_at: created,
          region,
          guild_id: guildId,
        };
        broadcast(payload, (c) => {
          if (ch === "GLOBAL") return true;
          if (ch === "GUILD") {
            const gu = db.prepare("SELECT guild_id FROM users WHERE id=?").get(c.user.id) as { guild_id: string | null };
            return gu.guild_id === guildId;
          }
          if (ch === "REGION") {
            const { character: oc } = game.requireAlive(c.user.id);
            return Number(oc?.region) === region;
          }
          return false;
        });
      }
    });

    ws.on("close", () => {
      clients.delete(client);
      broadcast({ type: "presence", username: user!.username, online: false });
    });
  });
}

export function onlineNames() {
  return [...clients].map((c) => c.user.username);
}
