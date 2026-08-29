import express from "express";
import { db, now } from "../db.ts";
import { hashPassword, checkPassword, setAuthCookie, requireAuth, requireAdmin, newId } from "../auth.ts";
import { CONFIG } from "../config.ts";
import * as game from "../game.ts";
import { hydrate, type InstanceRow } from "../engine/items.ts";
import { expireAuctions } from "../game.ts";
import { loadStorage, storageGridSize } from "../engine/inventory.ts";
import { broadcast } from "../wsHub.ts";
import { loadGate, publicStatus } from "../engine/gate.ts";

export const api = express.Router();

api.get("/status", (_req, res) => {
  res.json(publicStatus());
});

api.use((req, res, next) => {
  if (!loadGate().maintenance) return next();
  if (req.user?.role === "admin") return next();
  if (req.path === "/status" || req.path === "/config" || req.path.startsWith("/auth/")) return next();
  if (req.method === "GET" && req.path === "/me") return next();
  const g = loadGate();
  return res.status(503).json({ error: "The road is closed.", maintenance: true, message: g.message });
});

api.post("/auth/register", (req, res) => {
  const { email, password, username } = req.body || {};
  if (!email || !password || !username) return res.status(400).json({ error: "Email, password, and a name." });
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) return res.status(400).json({ error: "That email is a forgery." });
  if (String(password).length < 6) return res.status(400).json({ error: "Password too short for a lock." });
  if (!/^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(username)) return res.status(400).json({ error: "Username: 3–20 letters." });
  try {
    const id = newId();
    const t = now();
    db.prepare(
      `INSERT INTO users (id,email,username,password_hash,role,coins,storage_level,shop_level,auction_level,highest_region,created_at,last_seen)
       VALUES (?,?,?,?, 'player', ?, 1,1,1,0,?,?)`
    ).run(id, String(email).toLowerCase(), username, hashPassword(password), CONFIG.STARTING_COINS, t, t);
    const user = { id, email: String(email).toLowerCase(), username, role: "player" };
    setAuthCookie(res, user);
    res.json({ user });
  } catch {
    res.status(400).json({ error: "Email or name already carved." });
  }
});

api.post("/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare("SELECT * FROM users WHERE email = ?").get(String(email || "").toLowerCase()) as
    | { id: string; email: string; username: string; role: string; password_hash: string; banned_until: number | null; ban_reason: string | null }
    | undefined;
  if (!u || !checkPassword(String(password || ""), u.password_hash)) return res.status(400).json({ error: "The seal does not match." });
  if (u.banned_until && u.banned_until > Date.now()) return res.status(403).json({ error: `Banished: ${u.ban_reason}` });
  const user = { id: u.id, email: u.email, username: u.username, role: u.role };
  setAuthCookie(res, user);
  res.json({ user });
});

api.post("/auth/logout", (_req, res) => {
  res.clearCookie("ashmarch");
  res.json({ ok: true });
});

api.post("/auth/forgot", (req, res) => {
  const email = String(req.body?.email || "").toLowerCase();
  const u = db.prepare("SELECT id FROM users WHERE email=?").get(email) as { id: string } | undefined;
  if (u) {
    const token = newId();
    db.prepare("INSERT INTO password_resets (token, user_id, expires_at) VALUES (?,?,?)").run(token, u.id, now() + 3600_000);
    console.log(`[Ashmarch] Password reset for ${email}: ${token}`);
  }
  res.json({ ok: true, hint: "If the ledger knows that email, a token was spoken in the server log." });
});

api.post("/auth/reset", (req, res) => {
  const { token, password } = req.body || {};
  const row = db.prepare("SELECT * FROM password_resets WHERE token=?").get(token) as { user_id: string; expires_at: number } | undefined;
  if (!row || row.expires_at < now()) return res.status(400).json({ error: "Token spent or expired." });
  if (String(password || "").length < 6) return res.status(400).json({ error: "Password too short." });
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hashPassword(password), row.user_id);
  db.prepare("DELETE FROM password_resets WHERE token=?").run(token);
  res.json({ ok: true });
});

api.get("/me", requireAuth, (req, res) => {
  const u = db.prepare("SELECT id,email,username,role,coins,storage_level,shop_level,auction_level,highest_region,guild_id FROM users WHERE id=?").get(
    req.user!.id
  );
  const characters = db.prepare("SELECT * FROM characters WHERE user_id=? ORDER BY created_at DESC").all(req.user!.id);
  res.json({ user: u, characters });
});

api.get("/config", (_req, res) => {
  res.json({
    storageStart: CONFIG.STORAGE_START_SIZE,
    shopStart: CONFIG.SHOP_START_ITEMS,
    shopMax: CONFIG.SHOP_MAX_ITEMS,
    auctionStart: CONFIG.AUCTION_START_LISTINGS,
    auctionMax: CONFIG.AUCTION_MAX_LISTINGS,
    fee12: CONFIG.AUCTION_FEE_12H,
    fee24: CONFIG.AUCTION_FEE_24H,
    guildRegion: CONFIG.GUILD_REQUIRED_REGION,
    guildCost: CONFIG.GUILD_CREATION_COST,
    grid: { cols: CONFIG.GRID_COLS, rows: CONFIG.GRID_ROWS },
  });
});

api.post("/characters", requireAuth, (req, res) => {
  const r = game.createCharacter(req.user!.id, String(req.body?.name || ""), String(req.body?.class || ""));
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ id: r.id });
});

api.get("/game", requireAuth, (req, res) => {
  expireAuctions();
  const { error, character } = game.requireAlive(req.user!.id);
  if (error || !character) return res.json({ needCharacter: true, error });
  const snap = game.snapshotCharacter(character);
  const user = db.prepare("SELECT id,email,username,role,coins,storage_level,shop_level,auction_level,highest_region,guild_id FROM users WHERE id=?").get(
    req.user!.id
  );
  const storage =
    character.location === "CITY"
      ? {
          items: loadStorage(req.user!.id).map(hydrate),
          ...storageGridSize((user as { storage_level: number }).storage_level),
          level: (user as { storage_level: number }).storage_level,
          upgradeCost: CONFIG.STORAGE_UPGRADE_BASE * (user as { storage_level: number }).storage_level ** 2,
        }
      : null;
  res.json({ user, ...snap, storage });
});

api.post("/game/travel", requireAuth, (req, res) => {
  const r = game.travel(req.user!.id, String(req.body?.nodeId || ""));
  if (r.error) return res.status(400).json({ error: r.error });
  const { error: _e, ...rest } = r;
  res.json(rest);
});

api.post("/game/fight", requireAuth, (req, res) => {
  const r = game.startCombat(req.user!.id);
  if (r.error) return res.status(400).json({ error: r.error });
  const { error: _e, ...rest } = r;
  res.json(rest);
});

api.post("/game/advance", requireAuth, (req, res) => {
  const r = game.advanceAfterLoot(req.user!.id);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r);
});

api.post("/game/leave-city", requireAuth, (req, res) => {
  const r = game.leaveCity(req.user!.id);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r);
});

api.post("/game/loot", requireAuth, (req, res) => {
  const id = req.body?.instanceId;
  const r = game.pickLoot(req.user!.id, id == null || id === "" ? null : String(id));
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ ok: true });
});

api.post("/game/talent", requireAuth, (req, res) => {
  const r = game.pickTalent(req.user!.id, String(req.body?.talentId || req.body?.skillId || ""));
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ ok: true });
});

api.get("/forge/costs", requireAuth, (_req, res) => {
  res.json({ costs: CONFIG.FORGE_COST });
});

api.post("/forge", requireAuth, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const r = game.forgeItems(req.user!.id, ids);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r);
});

api.post("/items/move", requireAuth, (req, res) => {
  const r = game.moveItem(req.user!.id, req.body || {});
  if (r.error) return res.status(400).json(r);
  res.json({ ok: true });
});

api.post("/items/rotate", requireAuth, (req, res) => {
  const r = game.rotateItem(req.user!.id, String(req.body?.instanceId || ""));
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ ok: true });
});

api.get("/items/:id", requireAuth, (req, res) => {
  const inst = db.prepare("SELECT * FROM item_instances WHERE id=?").get(req.params.id) as InstanceRow | undefined;
  if (!inst || inst.location === "DESTROYED") return res.status(404).json({ error: "Item no longer exists." });
  res.json({ item: hydrate(inst) });
});

api.post("/items/link", requireAuth, (req, res) => {
  const id = String(req.body?.instanceId || "");
  const inst = db.prepare("SELECT * FROM item_instances WHERE id=?").get(id) as InstanceRow | undefined;
  if (!inst || inst.destroyed_at || inst.location === "DESTROYED") return res.status(400).json({ error: "Item no longer exists." });
  if (inst.owner_user_id !== req.user!.id && inst.location !== "AUCTION") {
    return res.status(400).json({ error: "You cannot seal what you do not hold." });
  }
  db.prepare("INSERT INTO item_links (id, instance_id, user_id, created_at) VALUES (?,?,?,?)").run(newId(), id, req.user!.id, now());
  const def = db.prepare("SELECT name FROM item_definitions WHERE id=?").get(inst.definition_id) as { name: string };
  res.json({ token: `ITEM_LINK:${id}`, name: def.name });
});

api.get("/shop", requireAuth, (req, res) => {
  const { error, character } = game.requireAlive(req.user!.id);
  if (error || !character) return res.status(400).json({ error });
  if (character.location !== "CITY") return res.status(400).json({ error: "The stall is in the city." });
  res.json(game.shopState(req.user!.id));
});

api.post("/shop/refresh", requireAuth, (req, res) => {
  const { error, character } = game.requireAlive(req.user!.id);
  if (character?.location !== "CITY") return res.status(400).json({ error: "The stall is in the city." });
  const r = game.refreshShop(req.user!.id, false);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(game.shopState(req.user!.id));
});

api.post("/shop/buy", requireAuth, (req, res) => {
  const r = game.buyShop(req.user!.id, String(req.body?.id || ""));
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ ok: true });
});

api.post("/shop/sell", requireAuth, (req, res) => {
  const r = game.sellItem(req.user!.id, String(req.body?.instanceId || ""));
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r);
});

api.post("/shop/upgrade", requireAuth, (req, res) => {
  const r = game.upgradeShop(req.user!.id);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ ok: true });
});

api.post("/storage/upgrade", requireAuth, (req, res) => {
  const { character } = game.requireAlive(req.user!.id);
  if (character?.location !== "CITY") return res.status(400).json({ error: "The vault opens only within the city walls." });
  const r = game.upgradeStorage(req.user!.id);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ ok: true });
});

api.get("/auction", requireAuth, (req, res) => {
  expireAuctions();
  const q = String(req.query.q || "");
  const rarity = String(req.query.rarity || "");
  let sql = `SELECT l.*, i.rarity, i.item_level, i.required_level, i.stats, i.definition_id, d.name AS item_name, d.set_id
             FROM auction_listings l
             JOIN item_instances i ON i.id = l.instance_id
             JOIN item_definitions d ON d.id = i.definition_id
             WHERE l.status='OPEN'`;
  const params: unknown[] = [];
  if (q) {
    sql += " AND d.name LIKE ?";
    params.push(`%${q}%`);
  }
  if (rarity) {
    sql += " AND i.rarity = ?";
    params.push(rarity);
  }
  sql += " ORDER BY l.created_at DESC LIMIT 80";
  const listings = db.prepare(sql).all(...params);
  const hydrated = listings.map((l: Record<string, unknown>) => {
    const inst = db.prepare("SELECT * FROM item_instances WHERE id=?").get(l.instance_id) as InstanceRow;
    return { ...l, item: hydrate(inst), seller: l.seller_name };
  });
  const user = db.prepare("SELECT auction_level FROM users WHERE id=?").get(req.user!.id) as { auction_level: number };
  const cap = Math.min(CONFIG.AUCTION_MAX_LISTINGS, CONFIG.AUCTION_START_LISTINGS + user.auction_level - 1);
  const mine = db.prepare("SELECT * FROM auction_listings WHERE seller_user_id=? AND status='OPEN'").all(req.user!.id);
  res.json({
    listings: hydrated,
    mine,
    cap,
    level: user.auction_level,
    upgradeCost: 600 * user.auction_level,
    fee12: CONFIG.AUCTION_FEE_12H,
    fee24: CONFIG.AUCTION_FEE_24H,
  });
});

api.post("/auction/list", requireAuth, (req, res) => {
  const r = game.listAuction(
    req.user!.id,
    req.user!.username,
    String(req.body?.instanceId || ""),
    Number(req.body?.price || 0),
    Number(req.body?.hours || 12) === 24 ? 24 : 12
  );
  if (r.error) return res.status(400).json({ error: r.error });
  broadcast({ type: "auction" });
  res.json(r);
});

api.post("/auction/buy", requireAuth, (req, res) => {
  const r = game.buyAuction(req.user!.id, String(req.body?.id || ""));
  if (r.error) return res.status(400).json({ error: r.error });
  broadcast({ type: "auction" });
  res.json({ ok: true });
});

api.post("/auction/cancel", requireAuth, (req, res) => {
  const r = game.cancelAuction(req.user!.id, String(req.body?.id || ""));
  if (r.error) return res.status(400).json({ error: r.error });
  broadcast({ type: "auction" });
  res.json({ ok: true });
});

api.post("/auction/upgrade", requireAuth, (req, res) => {
  const r = game.upgradeAuction(req.user!.id);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ ok: true });
});

api.get("/guilds", requireAuth, (_req, res) => {
  const list = db
    .prepare(
      `SELECT g.*, (SELECT COUNT(*) FROM guild_members m WHERE m.guild_id=g.id) AS members FROM guilds g ORDER BY g.level DESC, g.created_at`
    )
    .all();
  res.json({ guilds: list, requiredRegion: CONFIG.GUILD_REQUIRED_REGION, cost: CONFIG.GUILD_CREATION_COST });
});

api.get("/guild", requireAuth, (req, res) => {
  const u = db.prepare("SELECT guild_id FROM users WHERE id=?").get(req.user!.id) as { guild_id: string | null };
  if (!u.guild_id) return res.json({ guild: null });
  const g = db.prepare("SELECT * FROM guilds WHERE id=?").get(u.guild_id);
  const members = db
    .prepare(
      `SELECT m.rank, m.joined_at, u.username, u.id FROM guild_members m JOIN users u ON u.id=m.user_id WHERE m.guild_id=?`
    )
    .all(u.guild_id);
  const logs = db.prepare("SELECT * FROM guild_logs WHERE guild_id=? ORDER BY created_at DESC LIMIT 20").all(u.guild_id);
  const cap = CONFIG.GUILD_START_CAPACITY + (((g as { level: number }).level - 1) * CONFIG.GUILD_CAPACITY_PER_LEVEL);
  res.json({ guild: g, members, logs, cap, upgradeCost: CONFIG.GUILD_UPGRADE_BASE * (g as { level: number }).level });
});

api.post("/guilds", requireAuth, (req, res) => {
  const r = game.createGuild(
    req.user!.id,
    String(req.body?.name || ""),
    String(req.body?.tag || "").toUpperCase(),
    String(req.body?.description || ""),
    String(req.body?.emblem || "wolf")
  );
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r);
});

api.post("/guilds/:id/join", requireAuth, (req, res) => {
  const r = game.joinGuild(req.user!.id, req.params.id);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ ok: true });
});

api.post("/guild/leave", requireAuth, (req, res) => {
  const r = game.leaveGuild(req.user!.id);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ ok: true });
});

api.post("/guild/upgrade", requireAuth, (req, res) => {
  const r = game.upgradeGuild(req.user!.id);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ ok: true });
});

api.get("/chat", requireAuth, (req, res) => {
  const channel = String(req.query.channel || "GLOBAL");
  const { character } = game.requireAlive(req.user!.id);
  const u = db.prepare("SELECT guild_id FROM users WHERE id=?").get(req.user!.id) as { guild_id: string | null };
  let rows: unknown[] = [];
  if (channel === "GLOBAL") {
    rows = db.prepare("SELECT * FROM chat_messages WHERE channel='GLOBAL' ORDER BY created_at DESC LIMIT 80").all();
  } else if (channel === "REGION" && character) {
    rows = db
      .prepare("SELECT * FROM chat_messages WHERE channel='REGION' AND region=? ORDER BY created_at DESC LIMIT 80")
      .all(character.region);
  } else if (channel === "GUILD" && u.guild_id) {
    rows = db.prepare("SELECT * FROM chat_messages WHERE channel='GUILD' AND guild_id=? ORDER BY created_at DESC LIMIT 80").all(u.guild_id);
  }
  res.json({ messages: (rows as unknown[]).reverse() });
});

api.get("/chat/private/:userId", requireAuth, (req, res) => {
  const oid = req.params.userId;
  const rows = db
    .prepare(
      `SELECT * FROM private_messages WHERE (from_user_id=? AND to_user_id=?) OR (from_user_id=? AND to_user_id=?) ORDER BY created_at DESC LIMIT 80`
    )
    .all(req.user!.id, oid, oid, req.user!.id);
  db.prepare("UPDATE private_messages SET read_at=? WHERE to_user_id=? AND from_user_id=? AND read_at IS NULL").run(now(), req.user!.id, oid);
  res.json({ messages: (rows as unknown[]).reverse() });
});

api.post("/chat/block", requireAuth, (req, res) => {
  db.prepare("INSERT OR IGNORE INTO chat_blocks (user_id, blocked_user_id, created_at) VALUES (?,?,?)").run(
    req.user!.id,
    String(req.body?.userId),
    now()
  );
  res.json({ ok: true });
});

api.post("/chat/mute", requireAuth, (req, res) => {
  db.prepare("INSERT OR IGNORE INTO user_mutes (user_id, muted_user_id, created_at) VALUES (?,?,?)").run(
    req.user!.id,
    String(req.body?.userId),
    now()
  );
  res.json({ ok: true });
});

api.post("/chat/report", requireAuth, (req, res) => {
  db.prepare("INSERT INTO chat_reports (id, reporter_id, target_id, message_id, reason, created_at) VALUES (?,?,?,?,?,?)").run(
    newId(),
    req.user!.id,
    String(req.body?.userId),
    req.body?.messageId || null,
    String(req.body?.reason || "unspecified"),
    now()
  );
  res.json({ ok: true });
});

api.get("/players", requireAuth, (_req, res) => {
  const online = db.prepare("SELECT id, username, last_seen FROM users WHERE last_seen > ? ORDER BY username").all(now() - 60_000);
  res.json({ players: online });
});

api.get("/admin/summary", requireAuth, requireAdmin, (_req, res) => {
  res.json({
    users: db.prepare("SELECT COUNT(*) AS c FROM users").get(),
    characters: db.prepare("SELECT COUNT(*) AS c FROM characters").get(),
    items: db.prepare("SELECT COUNT(*) AS c FROM item_instances WHERE location != 'DESTROYED'").get(),
    listings: db.prepare("SELECT COUNT(*) AS c FROM auction_listings WHERE status='OPEN'").get(),
    tx: db.prepare("SELECT * FROM transactions ORDER BY created_at DESC LIMIT 40").all(),
    logs: db.prepare("SELECT * FROM game_logs ORDER BY created_at DESC LIMIT 40").all(),
    reports: db.prepare("SELECT * FROM chat_reports ORDER BY created_at DESC LIMIT 20").all(),
  });
});

api.get("/admin/users", requireAuth, requireAdmin, (_req, res) => {
  res.json({
    users: db.prepare("SELECT id,email,username,role,coins,highest_region,banned_until,muted_until FROM users").all(),
  });
});

api.get("/admin/ledger", requireAuth, requireAdmin, (_req, res) => {
  res.json(game.adminLedger());
});

api.post("/admin/character/delete", requireAuth, requireAdmin, (req, res) => {
  const out = game.adminEraseCharacter(String(req.body?.characterId || ""));
  if (out.error) return res.status(400).json({ error: out.error });
  res.json({ ok: true });
});

api.post("/admin/guild/delete", requireAuth, requireAdmin, (req, res) => {
  const out = game.adminDisbandGuild(String(req.body?.guildId || ""));
  if (out.error) return res.status(400).json({ error: out.error });
  res.json({ ok: true });
});

api.post("/admin/ban", requireAuth, requireAdmin, (req, res) => {
  db.prepare("UPDATE users SET banned_until=?, ban_reason=? WHERE id=?").run(
    now() + Number(req.body?.hours || 24) * 3600_000,
    String(req.body?.reason || "decree"),
    String(req.body?.userId)
  );
  res.json({ ok: true });
});

api.post("/admin/mute", requireAuth, requireAdmin, (req, res) => {
  db.prepare("UPDATE users SET muted_until=? WHERE id=?").run(now() + Number(req.body?.hours || 1) * 3600_000, String(req.body?.userId));
  res.json({ ok: true });
});

api.post("/admin/coins", requireAuth, requireAdmin, (req, res) => {
  const out = game.adminAdjustCoins(String(req.body?.userId || ""), Number(req.body?.amount || 0));
  if (out.error) return res.status(400).json({ error: out.error });
  res.json({ ok: true, coins: out.coins });
});

api.post("/admin/auction/cancel", requireAuth, requireAdmin, (req, res) => {
  db.prepare("UPDATE auction_listings SET status='CANCELLED' WHERE id=?").run(String(req.body?.id));
  res.json({ ok: true });
});

api.get("/admin/defs", requireAuth, requireAdmin, (_req, res) => {
  res.json({
    items: db.prepare("SELECT id,name,category,required_level,rarity_min,set_id FROM item_definitions ORDER BY required_level").all(),
    sets: db.prepare("SELECT * FROM item_sets").all(),
    enemies: db.prepare("SELECT id,name,kind,region,hp,damage FROM enemies ORDER BY region").all(),
    regions: db.prepare("SELECT * FROM regions").all(),
  });
});

api.get("/admin/drops", requireAuth, requireAdmin, (_req, res) => {
  res.json(game.adminDropTables());
});

api.post("/admin/drops", requireAuth, requireAdmin, (req, res) => {
  res.json(game.adminSaveDropTables(req.body));
});

api.post("/admin/drops/reset", requireAuth, requireAdmin, (_req, res) => {
  res.json(game.adminResetDropTables());
});

api.get("/admin/packs", requireAuth, requireAdmin, (_req, res) => {
  res.json(game.adminPackTables());
});

api.post("/admin/packs", requireAuth, requireAdmin, (req, res) => {
  res.json(game.adminSavePackTables(req.body));
});

api.post("/admin/packs/reset", requireAuth, requireAdmin, (_req, res) => {
  res.json(game.adminResetPackTables());
});

api.get("/admin/gate", requireAuth, requireAdmin, (_req, res) => {
  res.json(game.adminGate());
});

api.post("/admin/gate", requireAuth, requireAdmin, (req, res) => {
  res.json(game.adminSaveGate(req.body));
});

api.post("/admin/enemy", requireAuth, requireAdmin, (req, res) => {
  const b = req.body || {};
  db.prepare(
    `INSERT INTO enemies (id,name,kind,hp,damage,armor,crit_chance,attack_speed,dodge,abilities,loot_table,region,glyph)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, hp=excluded.hp, damage=excluded.damage, armor=excluded.armor`
  ).run(
    b.id || newId(),
    b.name,
    b.kind || "normal",
    Number(b.hp || 50),
    Number(b.damage || 8),
    Number(b.armor || 2),
    Number(b.crit_chance || 0.05),
    Number(b.attack_speed || 1),
    Number(b.dodge || 0.03),
    JSON.stringify(b.abilities || ["strike"]),
    JSON.stringify(b.loot_table || {}),
    Number(b.region || 1),
    b.glyph || "bandit"
  );
  res.json({ ok: true });
});
