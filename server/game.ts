import { v4 as uuid } from "uuid";
import { db, now, tx } from "./db.ts";
import { CONFIG } from "./config.ts";
import { emptyStats, EQUIP_SLOTS, parseStatsByRarity, RARITIES, sanitizeStats, STAT_KEYS, type Rarity, type Stats } from "./engine/stats.ts";
import { defaultXpConfig, loadXpConfig, saveXpConfig, xpForFight, xpToNext } from "./engine/progress.ts";
import { loadHeroBase, loadHeroCatalog, publicHeroes, seedHeroes, adminSaveHero as writeHero } from "./engine/heroTables.ts";
import { generateInstance, hydrate, destroyInstance, itemValue, itemSellGross, loadSellPct, parseValueByRarity, saveSellPct, rerollInstanceFromDefinition, rollRarity, type InstanceRow } from "./engine/items.ts";
import {
  buildGrid,
  canPlace,
  findPlace,
  loadInv,
  loadEquip,
  loadStorage,
  occupyCount,
  fillMissingSlots,
  storageCapacity,
  storageGridSize,
} from "./engine/inventory.ts";
import { characterPower, simulateCombat } from "./engine/combat.ts";
import { rollLoot, clearGround } from "./engine/loot.ts";
import { addCoins, spendCoins, logGame } from "./engine/economy.ts";
import { defaultDropConfig, loadDropConfig, saveDropConfig } from "./engine/dropTables.ts";
import { loadGate, saveGate } from "./engine/gate.ts";
import { defaultPackConfig, loadPackConfig, packOddsFor, rollPackExtra, savePackConfig } from "./engine/packTables.ts";
import { defaultMineConfig, loadMineConfig, ORE_META, oreIdForRarity, saveMineConfig, type OreId } from "./engine/mineTables.ts";
import {
  listAssetIcons,
  listItemIcons,
  loadItemCatalog,
  localesFor,
  normalizeIcon,
  saveItemI18n,
  saveUploadedAsset,
  saveUploadedIcon,
} from "./engine/itemCatalog.ts";
import { loadEnemyCatalog, localesForEnemy, saveEnemyI18n } from "./engine/enemyCatalog.ts";
import { applyTalentPick, canPickTalent, ensureTalentTree, freshTalentTree } from "./engine/talents.ts";
import {
  canFlee,
  combatKind,
  generateMarch,
  parseMarch,
  placeMines,
  placeCamps,
  reachableIds,
  rollMystery,
  seatAtCentralCity,
  toPublicMarch,
  isGuardedKind,
  type MarchState,
  type ResolvedKind,
} from "./engine/march.ts";
import { addCityTax, ensureCity, hubDepthOf, publicCity, unlockedCityMax } from "./engine/city.ts";
import {
  campCoinPayout,
  defaultMapGlobals,
  ensureMapTables,
  loadMapGlobals,
  mapRefreshMs,
  parkedMap,
  roadIsOpen,
  saveMapGlobals,
  upsertParkedMap,
} from "./engine/mapTables.ts";
import { defaultShopConfig, loadShopConfig, saveShopConfig, shopLevelRangeFor, shopRestockMs, shopWeightsFor } from "./engine/shopTables.ts";

export function publicItem(inst: InstanceRow) {
  return hydrate(inst);
}

function parseIdList(raw: unknown) {
  try {
    const a = JSON.parse(String(raw || "[]"));
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
}

function charOf(userId: string, characterId?: string) {
  if (characterId) {
    return db.prepare("SELECT * FROM characters WHERE id = ? AND user_id = ?").get(characterId, userId) as Record<string, unknown> | undefined;
  }
  return db.prepare("SELECT * FROM characters WHERE user_id = ? AND status = 'ALIVE' ORDER BY created_at DESC LIMIT 1").get(userId) as
    | Record<string, unknown>
    | undefined;
}

export function requireAlive(userId: string, characterId?: string) {
  const c = charOf(userId, characterId);
  if (!c) return { error: "No living wayfarer on this ledger." as const, character: null };
  if (c.status !== "ALIVE") return { error: "This wayfarer has already fallen." as const, character: null };
  return { error: null, character: c };
}

function syncVitals(character: { id: unknown; class: unknown; level: unknown; hp?: unknown; max_hp?: unknown }) {
  const power = characterPower({ id: String(character.id), class: String(character.class), level: Number(character.level) });
  const oldMax = Number(character.max_hp ?? 0);
  const oldHp = Number(character.hp ?? power.maxHp);
  const wasFull = !oldMax || oldHp >= oldMax;
  const hp = wasFull ? power.maxHp : Math.min(oldHp, power.maxHp);
  db.prepare("UPDATE characters SET max_hp=?, hp=? WHERE id=?").run(power.maxHp, hp, character.id);
  return { power, hp };
}

export function snapshotCharacter(c: Record<string, unknown>) {
  fillMissingSlots(String(c.id));
  maybeRefreshCurrentMap(c);
  const { power, hp } = syncVitals(c);
  c = { ...c, max_hp: power.maxHp, hp };
  const inv = loadInv(String(c.id)).map(publicItem);
  const eq = loadEquip(String(c.id)).map(publicItem);
  const pendingLoot = parseIdList(c.loot_pending);
  const lootChoices = pendingLoot
    .map((id) => {
      const row = db.prepare("SELECT * FROM item_instances WHERE id=?").get(id) as InstanceRow | undefined;
      if (!row || row.destroyed_at || row.location === "DESTROYED") return null;
      return publicItem(row);
    })
    .filter(Boolean);
  const ground = (
    db
      .prepare(
        `SELECT i.* FROM ground_loot g JOIN item_instances i ON i.id = g.instance_id WHERE g.character_id = ? AND i.location = 'GROUND'`
      )
      .all(c.id) as InstanceRow[]
  )
    .filter((row) => !pendingLoot.includes(row.id))
    .map(publicItem);
  const skills = db
    .prepare(
      `SELECT s.* FROM character_skills cs JOIN skills s ON s.id = cs.skill_id WHERE cs.character_id = ? ORDER BY cs.picked_at`
    )
    .all(c.id);
  const region = db.prepare("SELECT * FROM regions WHERE id = ?").get(c.region);
  if (c.skill_pending) {
    db.prepare("UPDATE characters SET skill_pending = 0, skill_offers = NULL WHERE id = ?").run(c.id);
    c = { ...c, skill_pending: 0, skill_offers: null };
  }
  const talentTree = ensureTalentTree(String(c.id), c.talent_tree);
  const talentPoints = Number(c.talent_points || 0);
  const march = ensureMarch(c);
  c = { ...c, depth: Number(c.depth || 1), round: Number(c.round || 1) };
  const hero = loadHeroBase(String(c.class));
  return {
    character: {
      ...c,
      power,
      talent_points: talentPoints,
      depth: Number(c.depth || 1),
      classIcon: hero?.portrait || hero?.icon || "",
      battleIcon: hero?.icon || "",
    },
    march: toPublicMarch(march),
    inventory: inv,
    equipment: eq,
    ground,
    lootChoices,
    skills,
    skillChoices: [],
    talentTree,
    talentPoints,
    region,
    grid: { cols: CONFIG.GRID_COLS, rows: CONFIG.GRID_ROWS },
    pendingFight: publicPendingFight(march),
    packOdds: packOddsFor(Math.max(1, Number(c.depth || 1))),
    city: String(c.location) === "CITY" ? publicCity(c) : null,
  };
}

export function createCharacter(userId: string, name: string, cls: string) {
  const alive = db.prepare("SELECT id FROM characters WHERE user_id = ? AND status = 'ALIVE'").get(userId);
  if (alive) return { error: "You already have a living wayfarer." };
  seedHeroes();
  const base = loadHeroBase(cls);
  if (!base) return { error: "Unknown calling." };
  if (!/^[A-Za-z][A-Za-z0-9 _-]{2,19}$/.test(name)) return { error: "A proper name, three to twenty letters." };
  const taken = db.prepare("SELECT id FROM characters WHERE name = ? COLLATE NOCASE AND status = 'ALIVE'").get(name);
  if (taken) return { error: "That name is already carved." };
  const id = uuid();
  const march = generateMarch(1);
  db.prepare(
    `INSERT INTO characters (id,user_id,name,class,level,xp,region,round,hp,max_hp,status,location,created_at)
     VALUES (?,?,?,?,1,0,1,1,?,?, 'ALIVE','WILD',?)`
  ).run(id, userId, name.trim(), cls, base.health, base.health, now());
  db.prepare("UPDATE characters SET talent_tree = ?, talent_points = 0, depth = 1, map_state = ? WHERE id = ?").run(
    JSON.stringify(freshTalentTree()),
    JSON.stringify(march),
    id
  );
  grantHeroStarters(userId, id, cls);
  const power = characterPower({ id, class: cls, level: 1 });
  db.prepare("UPDATE characters SET hp=?, max_hp=? WHERE id=?").run(power.maxHp, power.maxHp, id);
  return { error: null, id };
}

function grantHeroStarters(userId: string, characterId: string, heroId: string) {
  const kit = loadHeroBase(heroId)?.starters || [];
  if (!kit.length) return;
  const worn = new Set(loadEquip(characterId).map((e) => e.equip_slot).filter(Boolean) as string[]);
  const grid = buildGrid(loadInv(characterId));
  for (const defId of kit) {
    const def = db.prepare("SELECT id, slot FROM item_definitions WHERE id=?").get(defId) as { id: string; slot: string | null } | undefined;
    if (!def) continue;
    let inst: InstanceRow;
    try {
      inst = generateInstance({
        definitionId: def.id,
        ownerUserId: userId,
        ownerCharacterId: characterId,
        location: "INVENTORY",
        region: 1,
        forceRarity: "Common",
      });
    } catch {
      continue;
    }
    let slot: string | null = null;
    if (def.slot && (EQUIP_SLOTS as readonly string[]).includes(def.slot)) {
      if (def.slot === "Ring1" || def.slot === "Ring2") {
        slot = !worn.has("Ring1") ? "Ring1" : !worn.has("Ring2") ? "Ring2" : null;
      } else if (!worn.has(def.slot)) {
        slot = def.slot;
      }
    }
    if (slot) {
      db.prepare(
        "UPDATE item_instances SET location='EQUIPMENT', grid_x=NULL, grid_y=NULL, rotated=0, equip_slot=? WHERE id=?"
      ).run(slot, inst.id);
      worn.add(slot);
      continue;
    }
    const spot = findPlace(grid, inst);
    if (!spot) continue;
    db.prepare("UPDATE item_instances SET location='INVENTORY', grid_x=?, grid_y=?, rotated=0, equip_slot=NULL WHERE id=?").run(
      spot.x,
      spot.y,
      inst.id
    );
    grid[spot.y]![spot.x] = inst.id;
  }
}

function pickEnemy(regionId: number, kind: "normal" | "elite" | "boss") {
  const region = db.prepare("SELECT * FROM regions WHERE id = ?").get(regionId) as {
    enemy_pool: string;
    elite_pool: string;
    boss_id: string;
  };
  if (kind === "boss") {
    return db.prepare("SELECT * FROM enemies WHERE id = ?").get(region.boss_id);
  }
  if (kind === "elite") {
    const elites = JSON.parse(region.elite_pool) as string[];
    const id = elites[Math.floor(Math.random() * elites.length)];
    return db.prepare("SELECT * FROM enemies WHERE id = ?").get(id);
  }
  const pool = JSON.parse(region.enemy_pool) as string[];
  const id = pool[Math.floor(Math.random() * pool.length)];
  return db.prepare("SELECT * FROM enemies WHERE id = ?").get(id);
}

function saveMarch(characterId: unknown, state: MarchState) {
  db.prepare("UPDATE characters SET map_state = ? WHERE id = ?").run(JSON.stringify(state), characterId);
}

function maybeRefreshCurrentMap(character: Record<string, unknown>) {
  ensureMapTables();
  const d = Math.max(1, Number(character.depth) || 1);
  const parked = parkedMap(String(character.id), d);
  if (!parked?.refresh_at || now() < parked.refresh_at) return;
  const state = generateMarch(d, { fromCity: true });
  upsertParkedMap(String(character.id), d, JSON.stringify(state), null);
  saveMarch(character.id, state);
  db.prepare("UPDATE characters SET round=? WHERE id=?").run(5, character.id);
  character.map_state = JSON.stringify(state);
  character.round = 5;
}

function parkCurrentMap(character: Record<string, unknown>, refreshAt?: number | null) {
  ensureMapTables();
  const depth = Math.max(1, Number(character.depth) || 1);
  const raw = typeof character.map_state === "string" ? character.map_state : JSON.stringify(character.map_state || {});
  if (raw && raw !== "{}") upsertParkedMap(String(character.id), depth, raw, refreshAt);
}

function adoptDepthMap(character: Record<string, unknown>, depth: number, seatCity: boolean) {
  ensureMapTables();
  const d = Math.max(1, Math.trunc(depth));
  const parked = parkedMap(String(character.id), d);
  const due = parked?.refresh_at != null && now() >= parked.refresh_at;
  let state = !due && parked ? parseMarch(parked.map_state) : null;
  if (!state) {
    state = generateMarch(d, { fromCity: seatCity || due || !!parked });
    upsertParkedMap(String(character.id), d, JSON.stringify(state), null);
  } else if (seatCity) {
    seatAtCentralCity(state);
    upsertParkedMap(String(character.id), d, JSON.stringify(state), parked?.refresh_at ?? null);
  }
  const city = state.nodes.find((n) => n.kind === "city" && n.floor === 5);
  db.prepare("UPDATE characters SET depth=?, region=?, round=?, map_state=? WHERE id=?").run(
    d,
    Math.min(10, d),
    city?.floor || 5,
    JSON.stringify(state),
    character.id
  );
  character.depth = d;
  character.region = Math.min(10, d);
  character.round = city?.floor || 5;
  character.map_state = JSON.stringify(state);
  return state;
}

function ensureMarch(character: Record<string, unknown>): MarchState {
  let state = parseMarch(character.map_state);
  if (!state) {
    const inCity = character.location === "CITY";
    state = generateMarch(Math.max(1, Number(character.depth || 1)), { fromCity: inCity });
    if (inCity) {
      seatAtCentralCity(state);
      db.prepare("UPDATE characters SET round = ? WHERE id = ?").run(5, character.id);
    }
    saveMarch(character.id, state);
    character.map_state = JSON.stringify(state);
  }
  if (!Array.isArray(state.fled)) state.fled = [];
  if (!Array.isArray(state.fledEdges)) state.fledEdges = [];
  const skipPlaced = [
    ...state.visited,
    ...state.fled,
    state.current || "",
    state.pending || "",
    ...(state.fromCity ? state.nodes.filter((n) => n.floor < 5).map((n) => n.id) : []),
  ];
  let placed = false;
  if (!state.nodes.some((n) => n.kind === "mine")) {
    placeMines(state.nodes, Math.max(1, Number(character.depth || 1)), skipPlaced);
    placed = true;
  }
  if (!state.nodes.some((n) => n.kind === "camp")) {
    placeCamps(state.nodes, skipPlaced);
    placed = true;
  }
  if (placed) {
    saveMarch(character.id, state);
    character.map_state = JSON.stringify(state);
  }
  return state;
}

function finishPendingNode(character: Record<string, unknown>) {
  const state = ensureMarch(character);
  if (!state.pending) return { newAct: false };
  const node = state.nodes.find((n) => n.id === state.pending);
  if (!node) {
    state.pending = null;
    saveMarch(character.id, state);
    return { newAct: false };
  }
  if (!state.visited.includes(node.id)) state.visited.push(node.id);
  state.current = node.id;
  state.pending = null;
  const resolved = node.resolved || node.kind;
  if (resolved === "boss") {
    const oldDepth = Math.max(1, Number(character.depth) || 1);
    character.map_state = JSON.stringify(state);
    parkCurrentMap(character, now() + mapRefreshMs());
    if (oldDepth >= loadGate().maxDepth) {
      adoptDepthMap(character, oldDepth, true);
      db.prepare("UPDATE characters SET location='CITY', hub_depth=? WHERE id=?").run(oldDepth, character.id);
      character.location = "CITY";
      character.hub_depth = oldDepth;
      return { newAct: false };
    }
    const depth = oldDepth + 1;
    const region = Math.min(10, depth);
    const fresh = generateMarch(depth);
    upsertParkedMap(String(character.id), depth, JSON.stringify(fresh), null);
    db.prepare("UPDATE characters SET depth = ?, region = ?, round = 1, location = 'WILD', map_state = ? WHERE id = ?").run(
      depth,
      region,
      JSON.stringify(fresh),
      character.id
    );
    const u = db.prepare("SELECT highest_region FROM users WHERE id=?").get(character.user_id) as { highest_region: number };
    if (depth > u.highest_region) db.prepare("UPDATE users SET highest_region=? WHERE id=?").run(depth, character.user_id);
    character.depth = depth;
    character.region = region;
    character.round = 1;
    character.map_state = JSON.stringify(fresh);
    return { newAct: true };
  }
  saveMarch(character.id, state);
  db.prepare("UPDATE characters SET round = ? WHERE id = ?").run(node.floor, character.id);
  character.map_state = JSON.stringify(state);
  character.round = node.floor;
  return { newAct: false };
}

type EnemyRow = {
  id: string;
  name: string;
  kind: string;
  hp: number;
  damage: number;
  armor: number;
  crit_chance: number;
  attack_speed: number;
  dodge: number;
  abilities: string;
  loot_table: string;
  icon?: string;
};

type EnemyLoot = {
  undead?: boolean;
  icon?: string;
  regen?: number;
  poison?: number;
  poisonChance?: number;
  bleed?: number;
  bleedChance?: number;
  fireDmg?: number;
  fireHits?: number;
  fireChance?: number;
  heavyPct?: number;
};

function parseEnemyLoot(raw: string): EnemyLoot {
  try {
    const o = JSON.parse(raw || "{}");
    return o && typeof o === "object" ? (o as EnemyLoot) : {};
  } catch {
    return {};
  }
}

function enemyIconOf(enemy: EnemyRow, loot?: EnemyLoot) {
  const fromCol = String(enemy.icon || "").trim();
  if (fromCol) return fromCol;
  return String((loot || parseEnemyLoot(enemy.loot_table)).icon || "").trim();
}

function toFoe(enemy: EnemyRow) {
  const loot = parseEnemyLoot(enemy.loot_table);
  const abilities = JSON.parse(enemy.abilities || "[]") as string[];
  const has = (k: string) => abilities.includes(k);
  const regen = has("regen") ? Math.max(0, Number(loot.regen ?? 2)) : 0;
  const poison = has("poison") ? Math.max(0, Number(loot.poison ?? 4)) : 0;
  const poisonChance = has("poison") ? Math.max(0, Number(loot.poisonChance ?? 40)) : 0;
  const bleed = has("bleed") ? Math.max(0, Number(loot.bleed ?? 4)) : 0;
  const bleedChance = has("bleed") ? Math.max(0, Number(loot.bleedChance ?? 40)) : 0;
  const fireDmg = has("fire") ? Math.max(0, Number(loot.fireDmg ?? 4)) : 0;
  const fireHits = has("fire") ? Math.max(0, Math.trunc(Number(loot.fireHits ?? 3))) : 0;
  const fireChance = has("fire") ? Math.max(0, Number(loot.fireChance ?? 30)) : 0;
  const heavyPct = has("heavy") ? Math.max(0, Number(loot.heavyPct ?? 20)) : 0;
  return {
    id: String(enemy.id),
    name: enemy.name,
    hp: enemy.hp,
    maxHp: enemy.hp,
    undead: !!loot.undead,
    heavyPct,
    burnOnHit: fireDmg > 0 && fireHits > 0 ? { chance: fireChance, hits: fireHits, dmg: fireDmg } : undefined,
    stats: {
      ...emptyStats(),
      health: enemy.hp,
      damage: enemy.damage,
      armor: enemy.armor,
      critChance: enemy.crit_chance * 100,
      critDamage: 150,
      dodge: enemy.dodge * 100,
      regen,
      bleed,
      bleedChance,
      poison,
      poisonChance,
    },
  };
}

function pickEncounter(regionId: number, kind: "normal" | "elite" | "boss" | "mine" | "camp", depth: number): EnemyRow[] {
  const enemy = pickEnemy(regionId, isGuardedKind(kind) ? "normal" : kind) as EnemyRow;
  const pack = [enemy];
  const region = db.prepare("SELECT enemy_pool FROM regions WHERE id = ?").get(regionId) as { enemy_pool: string };
  const pool = JSON.parse(region.enemy_pool || "[]") as string[];
  const addOne = () => {
    const id = pool[Math.floor(Math.random() * pool.length)];
    const add = db.prepare("SELECT * FROM enemies WHERE id = ?").get(id) as EnemyRow | undefined;
    if (add) pack.push(add);
  };
  if (isGuardedKind(kind)) {
    addOne();
    const { three } = packOddsFor(depth);
    if (Math.random() * 100 < three) addOne();
    return pack;
  }
  if (kind === "normal") {
    const extra = rollPackExtra(depth);
    for (let i = 0; i < extra; i++) addOne();
  }
  return pack;
}

function foeAbilityView(enemy: EnemyRow) {
  const loot = parseEnemyLoot(enemy.loot_table);
  let listed: string[] = [];
  try {
    const raw = JSON.parse(enemy.abilities || "[]");
    listed = Array.isArray(raw) ? raw.map(String) : [];
  } catch {
    listed = [];
  }
  const has = (k: string) => listed.includes(k);
  const out: { id: string; n?: number; p?: number; d?: number; h?: number }[] = [];
  if (has("heavy")) out.push({ id: "heavy", n: Math.max(0, Number(loot.heavyPct ?? 20)) });
  if (has("regen")) out.push({ id: "regen", n: Math.max(0, Number(loot.regen ?? 2)) });
  if (has("bleed")) {
    out.push({
      id: "bleed",
      n: Math.max(0, Number(loot.bleed ?? 4)),
      p: Math.max(0, Number(loot.bleedChance ?? 40)),
    });
  }
  if (has("poison")) {
    out.push({
      id: "poison",
      n: Math.max(0, Number(loot.poison ?? 4)),
      p: Math.max(0, Number(loot.poisonChance ?? 40)),
    });
  }
  if (has("fire")) {
    out.push({
      id: "fire",
      d: Math.max(0, Number(loot.fireDmg ?? 4)),
      h: Math.max(0, Math.trunc(Number(loot.fireHits ?? 3))),
      p: Math.max(0, Number(loot.fireChance ?? 30)),
    });
  }
  if (loot.undead) out.push({ id: "undead" });
  return out;
}

function packView(pack: EnemyRow[]) {
  return pack.map((e, i) => ({
    id: `${e.id}#${i}`,
    name: e.name,
    kind: e.kind,
    hp: e.hp,
    maxHp: e.hp,
    damage: e.damage,
    armor: e.armor,
    icon: enemyIconOf(e),
    abilities: foeAbilityView(e),
  }));
}

function publicPendingFight(march: MarchState) {
  const pf = march.pendingFight;
  if (!pf?.enemyIds?.length) return null;
  const pack = pf.enemyIds
    .map((id) => db.prepare("SELECT * FROM enemies WHERE id = ?").get(id) as EnemyRow | undefined)
    .filter((e): e is EnemyRow => !!e);
  return pack.length ? packView(pack) : null;
}

function grantLoot(userId: string, character: Record<string, unknown>, power: { stats: { luck: number } }, enemyKind: string, ref: string) {
  const loot = rollLoot({
    userId,
    characterId: String(character.id),
    region: Number(character.region),
    enemyKind,
    luck: power.stats.luck,
    depth: Number(character.depth || 1),
    round: Number(character.round || 1),
  });
  db.prepare("UPDATE characters SET loot_pending=? WHERE id=?").run(
    JSON.stringify(loot.items.map((it) => it.id)),
    character.id
  );
  return loot;
}

function runCombat(userId: string, character: Record<string, unknown>, kind: "normal" | "elite" | "boss", pack: EnemyRow[]) {
  clearGround(String(character.id));
  const enemy = pack[0]!;
  const power = characterPower({
    id: String(character.id),
    class: String(character.class),
    level: Number(character.level),
  });
  const player = {
    id: "player",
    name: String(character.name),
    hp: Number(character.hp),
    maxHp: power.maxHp,
    stats: power.stats,
    isMagic: power.isMagic,
    magicSchool: power.magicSchool,
    talents: power.talentIds,
  };
  const foes = pack.map((e, i) => ({ ...toFoe(e), id: `${e.id}#${i}` }));
  const result = simulateCombat(player, foes);
  const enemiesOut = packView(pack).map((e, i) => ({
    ...e,
    hp: Math.max(0, Math.round(foes[i]!.hp)),
  }));
  if (result.won) {
    const loot = rollLoot({
      userId,
      characterId: String(character.id),
      region: Number(character.region),
      enemyKind: enemy.kind,
      luck: power.stats.luck,
      depth: Number(character.depth || 1),
      round: Number(character.round || 1),
    });
    const xpGain = xpForFight(Number(character.depth || 1), enemy.kind);
    let level = Number(character.level);
    let xp = Number(character.xp) + xpGain;
    let needed = xpToNext(level);
    while (xp >= needed) {
      xp -= needed;
      level++;
      needed = xpToNext(level);
    }
    const newMax = characterPower({ id: String(character.id), class: String(character.class), level }).maxHp;
    const talentGain = enemy.kind === "boss" ? 1 : 0;
    const afterHp = enemy.kind === "boss" ? newMax : Math.min(newMax, result.playerHp);
    db.prepare(
      `UPDATE characters SET hp=?, max_hp=?, level=?, xp=?, enemies_defeated = enemies_defeated + 1, loot_pending=?, talent_points = COALESCE(talent_points, 0) + ? WHERE id=?`
    ).run(
      afterHp,
      newMax,
      level,
      xp,
      JSON.stringify(loot.items.map((it) => it.id)),
      talentGain,
      character.id
    );
    const campGold = loot.items.length ? pendingCampGold(character) : grantCampCoins({ ...character, loot_pending: "[]" });
    if (!loot.items.length) {
      const ore = grantMineOre({ ...character, loot_pending: "[]" });
      finishPendingNode({ ...character, loot_pending: "[]" });
      return {
        error: null as string | null,
        result: {
          ...result,
          won: true,
          enemy,
          enemies: enemiesOut,
          gold: loot.gold,
          loot: loot.items.map(publicItem),
          xpGain,
          level,
          ore: ore ? publicItem(ore) : null,
          campGold: campGold || undefined,
        },
      };
    }
    return {
      error: null as string | null,
      result: {
        ...result,
        won: true,
        enemy,
        enemies: enemiesOut,
        gold: loot.gold,
        loot: loot.items.map(publicItem),
        xpGain,
        level,
        campGold: campGold || undefined,
      },
    };
  }
  return finishDeath(userId, character, enemy, { ...result, enemies: enemiesOut });
}

export function startCombat(userId: string) {
  return tx(() => {
    const { error, character } = requireAlive(userId);
    if (error || !character) return { error: error || "No character" };
    if (character.location === "CITY") return { error: "Leave the city first." };
    if (parseIdList(character.loot_pending).length) return { error: "Choose your spoils first." };
    const state = ensureMarch(character);
    const pf = state.pendingFight;
    if (!pf?.enemyIds?.length) return { error: "Choose a path on the map." };
    const pack = pf.enemyIds
      .map((id) => db.prepare("SELECT * FROM enemies WHERE id = ?").get(id) as EnemyRow | undefined)
      .filter((e): e is EnemyRow => !!e);
    if (!pack.length) return { error: "The ambush has scattered." };
    state.pendingFight = null;
    saveMarch(character.id, state);
    character.map_state = JSON.stringify(state);
    const fight = runCombat(userId, character, isGuardedKind(pf.kind) ? "normal" : pf.kind, pack);
    if (fight.error) return fight;
    return { error: null, action: "fight" as const, ...(fight.result ?? {}) };
  });
}

export function fleeCombat(userId: string) {
  return tx(() => {
    const { error, character } = requireAlive(userId);
    if (error || !character) return { error: error || "No character" };
    if (character.location === "CITY") return { error: "Leave the city first." };
    if (parseIdList(character.loot_pending).length) return { error: "Choose your spoils first." };
    const state = ensureMarch(character);
    if (!state.pending || !state.pendingFight) return { error: "There is no fight to flee." };
    if (!canFlee(state)) return { error: "This is the only path. You cannot flee." };
    if (!state.fled.includes(state.pending)) state.fled.push(state.pending);
    if (state.current && !state.fledEdges.some((e) => e.from === state.current && e.to === state.pending)) {
      state.fledEdges.push({ from: state.current, to: state.pending });
    }
    state.pending = null;
    state.pendingFight = null;
    saveMarch(character.id, state);
    const here = state.current ? state.nodes.find((n) => n.id === state.current) : null;
    db.prepare("UPDATE characters SET round = ? WHERE id = ?").run(here?.floor ?? 1, character.id);
    character.map_state = JSON.stringify(state);
    character.round = here?.floor ?? 1;
    return { error: null, action: "fled" as const };
  });
}

export function travel(userId: string, nodeId: string) {
  return tx(() => {
    const { error, character } = requireAlive(userId);
    if (error || !character) return { error: error || "No character" };
    if (character.location === "CITY") return { error: "Leave the city first." };
    if (parseIdList(character.loot_pending).length) return { error: "Choose your spoils first." };
    const state = ensureMarch(character);
    if (state.pending) return { error: "Finish this stretch first." };
    if (!reachableIds(state).includes(nodeId)) return { error: "That path is closed." };
    const node = state.nodes.find((n) => n.id === nodeId);
    if (!node) return { error: "That path is closed." };

    let resolved: ResolvedKind = (node.resolved || node.kind) as ResolvedKind;
    if (node.kind === "mystery" && !node.resolved) {
      resolved = rollMystery();
      node.resolved = resolved;
    } else if (
      node.kind === "monster" ||
      node.kind === "elite" ||
      node.kind === "boss" ||
      node.kind === "city" ||
      node.kind === "mine" ||
      node.kind === "camp"
    ) {
      resolved = node.kind;
    }

    state.pending = nodeId;
    saveMarch(character.id, state);
    db.prepare("UPDATE characters SET round = ? WHERE id = ?").run(node.floor, character.id);
    character.round = node.floor;
    character.map_state = JSON.stringify(state);

    if (resolved === "city") {
      const power = characterPower({
        id: String(character.id),
        class: String(character.class),
        level: Number(character.level),
      });
      const enterDepth = Math.max(1, Number(character.depth) || 1);
      db.prepare("UPDATE characters SET location='CITY', hub_depth=?, hp=?, max_hp=? WHERE id=?").run(
        enterDepth,
        power.maxHp,
        power.maxHp,
        character.id
      );
      character.location = "CITY";
      character.hub_depth = enterDepth;
      finishPendingNode(character);
      return { error: null, action: "city" as const };
    }

    if (resolved === "loot") {
      const power = characterPower({
        id: String(character.id),
        class: String(character.class),
        level: Number(character.level),
      });
      const loot = grantLoot(userId, character, power, "normal", `mystery:${nodeId}`);
      if (!loot.items.length) finishPendingNode(character);
      return { error: null, action: "loot" as const, gold: loot.gold, loot: loot.items.map(publicItem) };
    }

    const ck = combatKind(resolved);
    if (!ck) return { error: "That path is closed." };
    const pack = pickEncounter(Number(character.region), ck, Math.max(1, Number(character.depth || 1)));
    state.pendingFight = { kind: ck, enemyIds: pack.map((e) => e.id), ore: node.kind === "mine" ? node.ore : undefined };
    saveMarch(character.id, state);
    character.map_state = JSON.stringify(state);
    const enemies = packView(pack);
    return { error: null, action: "ambush" as const, enemy: enemies[0], enemies };
  });
}

function finishDeath(userId: string, character: Record<string, unknown>, enemy: { name: string }, result: { log: unknown; ticks: number; playerHp: number; enemies?: unknown }) {
  const cid = String(character.id);
  const inv = [...loadInv(cid), ...loadEquip(cid)];
  for (const it of inv) destroyInstance(it.id);
  clearGround(cid);
  db.prepare("DELETE FROM character_skills WHERE character_id = ?").run(cid);
  db.prepare("UPDATE characters SET status='DEAD', hp=0, died_at=?, location='WILD' WHERE id=?").run(now(), cid);
  db.prepare(
    `INSERT INTO deaths (id,user_id,character_id,character_name,class,level,region,round,enemies_defeated,gold_earned,best_item,loot_value,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    uuid(),
    userId,
    cid,
    character.name,
    character.class,
    character.level,
    character.region,
    character.round,
    character.enemies_defeated,
    character.gold_earned,
    character.best_item_name,
    character.loot_value,
    now()
  );
  logGame("DEATH", `${character.name} fell to ${enemy.name} in region ${character.region}`, userId);
  return {
    error: null,
    result: {
      won: false,
      dead: true,
      enemy,
      ...result,
      death: {
        character: character.name,
        class: character.class,
        level: character.level,
        region: character.region,
        round: character.round,
        enemies_defeated: character.enemies_defeated,
        gold_earned: character.gold_earned,
        best_item: character.best_item_name,
        loot_value: character.loot_value,
      },
    },
  };
}

export function pickLoot(userId: string, instanceId: string | null) {
  return tx(() => {
    const { error, character } = requireAlive(userId);
    if (error || !character) return { error };
    const ids = parseIdList(character.loot_pending);
    if (!ids.length) return { error: "No spoils to choose." };
    if (instanceId && !ids.includes(instanceId)) return { error: "That was not offered." };

    const rank = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"];
    let bestName = String(character.best_item_name || "");
    let bestR = String(character.best_item_rarity || "Common");
    let lootVal = Number(character.loot_value || 0);

    if (instanceId) {
      const inst = db.prepare("SELECT * FROM item_instances WHERE id=?").get(instanceId) as InstanceRow | undefined;
      if (!inst || inst.destroyed_at) return { error: "The item is gone." };
      const items = loadInv(String(character.id)).filter((i) => i.id !== inst.id);
      const grid = buildGrid(items);
      const spot = findPlace(grid, inst);
      if (!spot) return { error: "No space in the pack." };
      db.prepare(
        "UPDATE item_instances SET location='INVENTORY', owner_character_id=?, grid_x=?, grid_y=?, rotated=?, equip_slot=NULL WHERE id=?"
      ).run(character.id, spot.x, spot.y, spot.rotated, inst.id);
      db.prepare("DELETE FROM ground_loot WHERE instance_id=?").run(inst.id);
      lootVal += itemValue(inst);
      const def = db.prepare("SELECT name FROM item_definitions WHERE id = ?").get(inst.definition_id) as { name: string };
      if (rank.indexOf(inst.rarity) >= rank.indexOf(bestR)) {
        bestR = inst.rarity;
        bestName = def.name;
      }
    }

    for (const id of ids) {
      if (id === instanceId) continue;
      destroyInstance(id);
      db.prepare("DELETE FROM ground_loot WHERE instance_id=?").run(id);
    }

    db.prepare("UPDATE characters SET loot_pending=NULL, best_item_name=?, best_item_rarity=?, loot_value=? WHERE id=?").run(
      bestName || null,
      bestR,
      lootVal,
      character.id
    );
    const row = db.prepare("SELECT * FROM characters WHERE id=?").get(character.id) as Record<string, unknown>;
    const ore = grantMineOre(row);
    const campGold = grantCampCoins(row);
    finishPendingNode(row);
    return { error: null, ore: ore ? publicItem(ore) : null, campGold: campGold || undefined };
  });
}

function grantMineOre(character: Record<string, unknown>): InstanceRow | null {
  const state = parseMarch(character.map_state);
  if (!state?.pending) return null;
  const node = state.nodes.find((n) => n.id === state.pending);
  if (node?.kind !== "mine" || !node.ore) return null;
  const meta = ORE_META[node.ore as OreId];
  if (!meta) return null;
  const def = db.prepare("SELECT id FROM item_definitions WHERE id = ?").get(meta.defId);
  if (!def) return null;
  try {
    const inst = generateInstance({
      definitionId: meta.defId,
      ownerUserId: String(character.user_id),
      ownerCharacterId: String(character.id),
      location: "INVENTORY",
      forceRarity: meta.rarity as "Common" | "Uncommon" | "Rare" | "Epic" | "Legendary" | "Mythic",
    });
    const items = loadInv(String(character.id)).filter((i) => i.id !== inst.id);
    const grid = buildGrid(items);
    const spot = findPlace(grid, inst);
    if (!spot) {
      destroyInstance(inst.id);
      return null;
    }
    db.prepare("UPDATE item_instances SET grid_x=?, grid_y=?, rotated=? WHERE id=?").run(spot.x, spot.y, spot.rotated, inst.id);
    inst.grid_x = spot.x;
    inst.grid_y = spot.y;
    inst.rotated = spot.rotated;
    return inst;
  } catch {
    return null;
  }
}

function pendingCampGold(character: Record<string, unknown>): number {
  const state = parseMarch(character.map_state);
  if (!state?.pending) return 0;
  const node = state.nodes.find((n) => n.id === state.pending);
  if (node?.kind !== "camp") return 0;
  return campCoinPayout(Math.max(1, Number(character.depth) || 1));
}

function grantCampCoins(character: Record<string, unknown>): number {
  const gold = pendingCampGold(character);
  if (gold <= 0) return 0;
  const state = parseMarch(character.map_state);
  const node = state?.nodes.find((n) => n.id === state.pending);
  addCoins(String(character.user_id), gold, "CAMP", `camp:${node?.id || "camp"}`, { depth: character.depth });
  db.prepare("UPDATE characters SET gold_earned = gold_earned + ? WHERE id=?").run(gold, character.id);
  return gold;
}

export function pickTalent(userId: string, talentId: string) {
  return tx(() => {
    const { error, character } = requireAlive(userId);
    if (error || !character) return { error };
    if (Number(character.talent_points || 0) < 1) return { error: "No talent to spend. Slay a boss first." };
    const tree = ensureTalentTree(String(character.id), character.talent_tree);
    if (!canPickTalent(tree, talentId)) return { error: "That talent cannot be taken yet." };
    applyTalentPick(String(character.id), tree, talentId);
    return { error: null };
  });
}

export function pickSkill(userId: string, skillId: string) {
  return pickTalent(userId, skillId);
}

export function advanceAfterLoot(userId: string) {
  return tx(() => {
    const { error, character } = requireAlive(userId);
    if (error || !character) return { error };
    if (parseIdList(character.loot_pending).length) return { error: "Choose your spoils first." };
    const leftover = db.prepare("SELECT COUNT(*) AS c FROM ground_loot g JOIN item_instances i ON i.id = g.instance_id WHERE g.character_id=? AND i.location='GROUND'").get(character.id) as { c: number };
    if (leftover.c > 0) {
      clearGround(String(character.id));
    }
    finishPendingNode(character);
    return { error: null, city: character.location === "CITY" };
  });
}

export function leaveCity(userId: string) {
  const { error, character } = requireAlive(userId);
  if (error || !character) return { error };
  if (character.location !== "CITY") return { error: "You are already on the road." };
  maybeRefreshCurrentMap(character);
  const depth = Math.max(1, Number(character.depth) || 1);
  if (depth >= loadGate().maxDepth) return { error: "You have reached the maximum depth." };
  if (!roadIsOpen(String(character.id), depth)) return { error: "The road is not yet remade." };
  db.prepare("UPDATE characters SET location='WILD' WHERE id=?").run(character.id);
  return { error: null };
}

export function switchCity(userId: string, depth: number) {
  const { error, character } = requireAlive(userId);
  if (error || !character) return { error };
  if (character.location !== "CITY") return { error: "Leave the road first." };
  const d = Math.trunc(Number(depth));
  if (!Number.isFinite(d) || d < 1) return { error: "That city is not charted yet." };
  if (d > loadGate().maxDepth) return { error: "You have reached the maximum depth." };
  const user = db.prepare("SELECT highest_region FROM users WHERE id=?").get(userId) as { highest_region: number };
  if (d > unlockedCityMax(character, user.highest_region)) return { error: "That city is not charted yet." };
  ensureCity(d);
  parkCurrentMap(character);
  adoptDepthMap(character, d, true);
  db.prepare("UPDATE characters SET hub_depth=?, location='CITY' WHERE id=?").run(d, character.id);
  character.hub_depth = d;
  character.location = "CITY";
  return { error: null };
}

export function moveItem(userId: string, opts: {
  instanceId: string;
  dest: "INVENTORY" | "STORAGE" | "EQUIPMENT" | "GROUND" | "DISCARD";
  x?: number;
  y?: number;
  rotated?: number;
  slot?: string;
}) {
  return tx(() => {
    const { error, character } = requireAlive(userId);
    if (error || !character) return { error };
    const inst = db.prepare("SELECT * FROM item_instances WHERE id = ?").get(opts.instanceId) as InstanceRow | undefined;
    if (!inst || inst.destroyed_at) return { error: "The item is gone." };
    if (inst.owner_user_id !== userId) return { error: "That is not yours." };

    if (opts.dest === "DISCARD") {
      if (inst.location !== "INVENTORY" && inst.location !== "GROUND") return { error: "You cannot discard that here." };
      destroyInstance(inst.id);
      db.prepare("DELETE FROM ground_loot WHERE instance_id=?").run(inst.id);
      return { error: null };
    }

    if (opts.dest === "STORAGE" || inst.location === "STORAGE") {
      if (character.location !== "CITY") return { error: "The vault opens only within the city walls." };
    }

    if (opts.dest === "INVENTORY") {
      const items = loadInv(String(character.id)).filter((i) => i.id !== inst.id);
      const grid = buildGrid(items);
      const rotated = opts.rotated ?? inst.rotated;
      const probe = { ...inst, rotated };
      let x = opts.x;
      let y = opts.y;
      if (x == null || y == null || !canPlace(grid, probe, x, y)) {
        const spot = findPlace(grid, probe);
        if (!spot) return { error: "No space in the pack." };
        x = spot.x;
        y = spot.y;
        probe.rotated = 0;
      }
      if (inst.location === "STORAGE" && character.location !== "CITY") return { error: "The vault opens only within the city walls." };
      if (inst.location === "GROUND") db.prepare("DELETE FROM ground_loot WHERE instance_id=?").run(inst.id);
      db.prepare(
        "UPDATE item_instances SET location='INVENTORY', owner_character_id=?, grid_x=?, grid_y=?, rotated=?, equip_slot=NULL WHERE id=?"
      ).run(character.id, x, y, probe.rotated, inst.id);
      if (inst.location === "EQUIPMENT") syncVitals(character);
      return { error: null };
    }

    if (opts.dest === "STORAGE") {
      const user = db.prepare("SELECT storage_level FROM users WHERE id=?").get(userId) as { storage_level: number };
      const { cols, rows, cells } = storageGridSize(user.storage_level);
      const items = loadStorage(userId).filter((i) => i.id !== inst.id);
      if (occupyCount(items) + 1 > cells) {
        return { error: "The chest is full. Pay the carpenter to enlarge it." };
      }
      const grid = buildGrid(items, cols, rows);
      const rotated = opts.rotated ?? inst.rotated;
      const probe = { ...inst, rotated };
      let x = opts.x;
      let y = opts.y;
      if (x == null || y == null || !canPlace(grid, probe, x, y)) {
        const spot = findPlace(grid, probe);
        if (!spot) return { error: "No space in the chest." };
        x = spot.x;
        y = spot.y;
        probe.rotated = 0;
      }
      db.prepare(
        "UPDATE item_instances SET location='STORAGE', owner_character_id=NULL, grid_x=?, grid_y=?, rotated=?, equip_slot=NULL WHERE id=?"
      ).run(x, y, probe.rotated, inst.id);
      if (inst.location === "EQUIPMENT") syncVitals(character);
      return { error: null };
    }

    if (opts.dest === "EQUIPMENT") {
      const slot = opts.slot;
      if (!slot || !(EQUIP_SLOTS as readonly string[]).includes(slot)) return { error: "Which harness?" };
      const def = db.prepare("SELECT slot FROM item_definitions WHERE id=?").get(inst.definition_id) as { slot: string | null };
      if (!def?.slot || !(EQUIP_SLOTS as readonly string[]).includes(def.slot)) return { error: "That cannot be worn." };
      const allowed =
        def.slot === slot ||
        (def.slot === "Ring1" && (slot === "Ring1" || slot === "Ring2")) ||
        (def.slot === "Ring2" && (slot === "Ring1" || slot === "Ring2"));
      if (!allowed) return { error: `This belongs in ${def.slot}.` };
      const lvl = Number(character.level);
      if (CONFIG.ITEM_REQUIRED_LEVEL && inst.required_level > lvl) {
        return {
          error: `REQUIRED LEVEL: ${inst.required_level}\nYOUR LEVEL: ${lvl}`,
          required: inst.required_level,
          yours: lvl,
        };
      }
      const occupying = db
        .prepare("SELECT * FROM item_instances WHERE owner_character_id=? AND location='EQUIPMENT' AND equip_slot=?")
        .get(character.id, slot) as InstanceRow | undefined;
      if (occupying) {
        const items = loadInv(String(character.id)).filter((i) => i.id !== inst.id);
        const grid = buildGrid(items);
        const spot = findPlace(grid, occupying);
        if (!spot) return { error: "No room to unequip what you wear." };
        db.prepare(
          "UPDATE item_instances SET location='INVENTORY', grid_x=?, grid_y=?, rotated=?, equip_slot=NULL WHERE id=?"
        ).run(spot.x, spot.y, spot.rotated, occupying.id);
      }
      db.prepare(
        "UPDATE item_instances SET location='EQUIPMENT', owner_character_id=?, grid_x=NULL, grid_y=NULL, equip_slot=? WHERE id=?"
      ).run(character.id, slot, inst.id);
      syncVitals(character);
      return { error: null };
    }

    return { error: "Unknown destination." };
  });
}

export function rotateItem(userId: string, instanceId: string) {
  const { error, character } = requireAlive(userId);
  if (error || !character) return { error };
  const inst = db.prepare("SELECT * FROM item_instances WHERE id=?").get(instanceId) as InstanceRow | undefined;
  if (!inst || inst.owner_user_id !== userId) return { error: "Not yours." };
  if (inst.location !== "INVENTORY" && inst.location !== "STORAGE") return { error: "Cannot turn that here." };
  if (inst.location === "STORAGE" && character.location !== "CITY") return { error: "The vault opens only within the city walls." };
  const items = inst.location === "STORAGE" ? loadStorage(userId) : loadInv(String(character.id));
  const others = items.filter((i) => i.id !== inst.id);
  const user = db.prepare("SELECT storage_level FROM users WHERE id=?").get(userId) as { storage_level: number };
  const gsize = inst.location === "STORAGE" ? storageGridSize(user.storage_level) : { cols: CONFIG.GRID_COLS, rows: CONFIG.GRID_ROWS };
  const grid = buildGrid(others, gsize.cols, gsize.rows);
  const probe = { ...inst, rotated: inst.rotated ? 0 : 1 };
  const x = inst.grid_x ?? 0;
  const y = inst.grid_y ?? 0;
  if (!canPlace(grid, probe, x, y)) {
    const spot = findPlace(grid, probe);
    if (!spot) return { error: "No room to turn it." };
    db.prepare("UPDATE item_instances SET rotated=?, grid_x=?, grid_y=? WHERE id=?").run(spot.rotated, spot.x, spot.y, inst.id);
    return { error: null };
  }
  db.prepare("UPDATE item_instances SET rotated=? WHERE id=?").run(probe.rotated, inst.id);
  return { error: null };
}

function shopStockOwner(depth: number) {
  const city = ensureCity(depth);
  if (city.owner_user_id) return city.owner_user_id;
  const admin = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get() as { id: string } | undefined;
  if (admin) return admin.id;
  const any = db.prepare("SELECT id FROM users LIMIT 1").get() as { id: string } | undefined;
  return any?.id ?? null;
}

function canManageShop(userId: string, depth: number) {
  const user = db.prepare("SELECT role FROM users WHERE id=?").get(userId) as { role: string } | undefined;
  if (user?.role === "admin") return true;
  const city = ensureCity(depth);
  return !!city.owner_user_id && city.owner_user_id === userId;
}

function scheduleShopRestock(depth: number, from = now()) {
  db.prepare("UPDATE cities SET shop_restock_at=? WHERE depth=?").run(from + shopRestockMs(), depth);
}

function fillCityShop(depth: number, ownerUserId: string) {
  const city = ensureCity(depth);
  const old = db.prepare("SELECT instance_id FROM city_shop_items WHERE city_depth=?").all(depth) as { instance_id: string }[];
  for (const o of old) destroyInstance(o.instance_id);
  db.prepare("DELETE FROM city_shop_items WHERE city_depth=?").run(depth);
  const slots = Math.min(CONFIG.SHOP_MAX_ITEMS, CONFIG.SHOP_START_ITEMS + city.shop_level - 1);
  const range = shopLevelRangeFor(depth);
  let defs = db
    .prepare(
      "SELECT id, rarity_min, required_level FROM item_definitions WHERE required_level >= ? AND required_level <= ? AND slot IS NOT NULL AND slot != '' AND IFNULL(category,'') != 'ore'"
    )
    .all(range.min, range.max) as { id: string; rarity_min: string; required_level: number }[];
  if (!defs.length) {
    defs = db
      .prepare(
        "SELECT id, rarity_min, required_level FROM item_definitions WHERE required_level <= ? AND slot IS NOT NULL AND slot != '' AND IFNULL(category,'') != 'ore'"
      )
      .all(range.max) as { id: string; rarity_min: string; required_level: number }[];
  }
  const weights = shopWeightsFor(depth);
  const minIdxOf = (min: string) => {
    const i = RARITIES.indexOf(min as (typeof RARITIES)[number]);
    return i < 0 ? 0 : i;
  };
  for (let i = 0; i < slots; i++) {
    if (!defs.length) break;
    const rarity = rollRarity(0, undefined, weights);
    const rIdx = RARITIES.indexOf(rarity);
    let pool = defs.filter((d) => minIdxOf(d.rarity_min) <= rIdx);
    if (!pool.length) pool = defs;
    const def = pool[Math.floor(Math.random() * pool.length)]!;
    const inst = generateInstance({
      definitionId: def.id,
      ownerUserId,
      location: "SHOP",
      region: depth,
      forceRarity: rarity,
    });
    const price = itemValue(inst);
    db.prepare("INSERT INTO city_shop_items (id,city_depth,instance_id,price,slot,generated_at) VALUES (?,?,?,?,?,?)").run(
      uuid(),
      depth,
      inst.id,
      price,
      i,
      now()
    );
  }
  scheduleShopRestock(depth);
}

function maybeRestockCity(depth: number) {
  const city = ensureCity(depth);
  const stock = db.prepare("SELECT COUNT(*) AS c FROM city_shop_items WHERE city_depth=?").get(depth) as { c: number };
  if (stock.c > 0 && city.shop_restock_at == null) {
    scheduleShopRestock(depth);
    return false;
  }
  const due = city.shop_restock_at != null && city.shop_restock_at <= now();
  const never = stock.c === 0 && city.shop_restock_at == null;
  if (!due && !never) return false;
  const owner = shopStockOwner(depth);
  if (!owner) return false;
  fillCityShop(depth, owner);
  return true;
}

export function restockDueShops() {
  const rows = db.prepare("SELECT depth FROM cities").all() as { depth: number }[];
  const changed: number[] = [];
  for (const row of rows) {
    if (maybeRestockCity(row.depth)) changed.push(row.depth);
  }
  return changed;
}

function publicShop(userId: string, character: Record<string, unknown>) {
  const depth = hubDepthOf(character);
  const city = ensureCity(depth);
  const slots = Math.min(CONFIG.SHOP_MAX_ITEMS, CONFIG.SHOP_START_ITEMS + city.shop_level - 1);
  const rows = db.prepare("SELECT * FROM city_shop_items WHERE city_depth=? ORDER BY slot").all(depth) as {
    id: string;
    instance_id: string;
    price: number;
    slot: number;
  }[];
  const items = rows
    .map((r) => {
      const inst = db.prepare("SELECT * FROM item_instances WHERE id=?").get(r.instance_id) as InstanceRow | undefined;
      if (!inst) return null;
      return { ...r, item: publicItem(inst) };
    })
    .filter(Boolean);
  const fresh = db.prepare("SELECT shop_restock_at, shop_level, tax_percent FROM cities WHERE depth=?").get(depth) as {
    shop_restock_at: number | null;
    shop_level: number;
    tax_percent: number;
  };
  return {
    depth,
    slots,
    level: fresh.shop_level,
    items,
    refreshCost: CONFIG.SHOP_REFRESH_COST,
    upgradeCost: CONFIG.SHOP_UPGRADE_BASE * fresh.shop_level,
    taxPercent: fresh.tax_percent,
    restockAt: fresh.shop_restock_at,
    restockMinutes: loadShopConfig().restockMinutes,
    canManage: canManageShop(userId, depth),
  };
}

export function shopState(userId: string) {
  const { error, character } = requireAlive(userId);
  if (error || !character) {
    return {
      slots: 0,
      level: 1,
      items: [],
      refreshCost: CONFIG.SHOP_REFRESH_COST,
      upgradeCost: 0,
      taxPercent: 0,
      restockAt: null,
      canManage: false,
      restocked: false,
    };
  }
  const depth = hubDepthOf(character);
  const restocked = maybeRestockCity(depth);
  return { ...publicShop(userId, character), restocked };
}

export function refreshShop(userId: string, free = false) {
  return tx(() => {
    const { error, character } = requireAlive(userId);
    if (error || !character) return { error: error || "No living wayfarer on this ledger." };
    if (character.location !== "CITY") return { error: "The stall is in the city." };
    const depth = hubDepthOf(character);
    if (!canManageShop(userId, depth)) return { error: "Only the city ruler may tend the stall." };
    if (!free && !spendCoins(userId, CONFIG.SHOP_REFRESH_COST, "SHOP_REFRESH", "shop")) return { error: "Not enough coins." };
    fillCityShop(depth, userId);
    return { error: null, depth };
  });
}

export function buyShop(userId: string, shopItemId: string) {
  return tx(() => {
    const { error, character } = requireAlive(userId);
    if (error || !character) return { error };
    if (character.location !== "CITY") return { error: "The stall is in the city." };
    const depth = hubDepthOf(character);
    const row = db.prepare("SELECT * FROM city_shop_items WHERE id=? AND city_depth=?").get(shopItemId, depth) as
      | { instance_id: string; price: number }
      | undefined;
    if (!row) return { error: "Already sold." };
    if (!spendCoins(userId, row.price, "SHOP_BUY", "shop", { instance: row.instance_id })) return { error: "Not enough coins." };
    const inst = db.prepare("SELECT * FROM item_instances WHERE id=?").get(row.instance_id) as InstanceRow;
    const items = loadInv(String(character.id));
    const grid = buildGrid(items);
    const spot = findPlace(grid, inst);
    if (!spot) {
      addCoins(userId, row.price, "SHOP_BUY", "shop-refund-no-space");
      return { error: "No space in the pack." };
    }
    db.prepare(
      "UPDATE item_instances SET location='INVENTORY', owner_user_id=?, owner_character_id=?, grid_x=?, grid_y=?, rotated=? WHERE id=?"
    ).run(userId, character.id, spot.x, spot.y, spot.rotated, inst.id);
    db.prepare("DELETE FROM city_shop_items WHERE instance_id=?").run(inst.id);
    return { error: null, depth };
  });
}

export function sellItem(userId: string, instanceId: string) {
  return tx(() => {
    const { error, character } = requireAlive(userId);
    if (error || !character) return { error };
    if (character.location !== "CITY") return { error: "Merchants keep to the city." };
    const inst = db.prepare("SELECT * FROM item_instances WHERE id=?").get(instanceId) as InstanceRow | undefined;
    if (!inst || inst.owner_user_id !== userId) return { error: "Not yours." };
    if (inst.location !== "INVENTORY" && inst.location !== "STORAGE") return { error: "You cannot sell that here." };
    if (inst.location === "STORAGE" && character.location !== "CITY") return { error: "The vault opens only within the city walls." };
    const depth = hubDepthOf(character);
    const city = ensureCity(depth);
    const gross = itemSellGross(inst);
    const taxPct = Math.max(0, Math.min(100, Number(city.tax_percent) || 0));
    const tax = Math.floor((gross * taxPct) / 100);
    const price = gross - tax;
    destroyInstance(inst.id);
    if (tax > 0) addCityTax(depth, tax);
    addCoins(userId, price, "ITEM_SELL", "shop", { instance: instanceId, tax, city: depth });
    return { error: null, price, tax, gross };
  });
}

export function upgradeShop(userId: string) {
  return tx(() => {
    const { error, character } = requireAlive(userId);
    if (error || !character) return { error };
    if (character.location !== "CITY") return { error: "The stall is in the city." };
    const depth = hubDepthOf(character);
    if (!canManageShop(userId, depth)) return { error: "Only the city ruler may tend the stall." };
    const city = ensureCity(depth);
    if (CONFIG.SHOP_START_ITEMS + city.shop_level - 1 >= CONFIG.SHOP_MAX_ITEMS) return { error: "The stall is as wide as it will go." };
    const cost = CONFIG.SHOP_UPGRADE_BASE * city.shop_level;
    if (!spendCoins(userId, cost, "UPGRADE", "shop-level")) return { error: "Not enough coins." };
    db.prepare("UPDATE cities SET shop_level = shop_level + 1 WHERE depth=?").run(depth);
    fillCityShop(depth, userId);
    return { error: null, depth };
  });
}

export function upgradeStorage(userId: string) {
  const user = db.prepare("SELECT storage_level FROM users WHERE id=?").get(userId) as { storage_level: number };
  if (user.storage_level >= CONFIG.STORAGE_MAX_LEVEL) return { error: "The vault cannot swell further." };
  const cost = CONFIG.STORAGE_UPGRADE_BASE * user.storage_level * user.storage_level;
  if (!spendCoins(userId, cost, "UPGRADE", "storage-level")) return { error: "Not enough coins." };
  db.prepare("UPDATE users SET storage_level = storage_level + 1 WHERE id=?").run(userId);
  return { error: null };
}

export function upgradeAuction(userId: string) {
  const user = db.prepare("SELECT auction_level FROM users WHERE id=?").get(userId) as { auction_level: number };
  const slots = CONFIG.AUCTION_START_LISTINGS + user.auction_level - 1;
  if (slots >= CONFIG.AUCTION_MAX_LISTINGS) return { error: "The board holds all it can." };
  const cost = 600 * user.auction_level;
  if (!spendCoins(userId, cost, "UPGRADE", "auction-level")) return { error: "Not enough coins." };
  db.prepare("UPDATE users SET auction_level = auction_level + 1 WHERE id=?").run(userId);
  return { error: null };
}

export function listAuction(userId: string, username: string, instanceId: string, price: number, hours: 12 | 24) {
  return tx(() => {
    const { error, character } = requireAlive(userId);
    if (error || !character) return { error };
    if (character.location !== "CITY") return { error: "The board stands in the square." };
    if (price < 1 || !Number.isFinite(price)) return { error: "Name a real price." };
    const user = db.prepare("SELECT auction_level FROM users WHERE id=?").get(userId) as { auction_level: number };
    const cap = Math.min(CONFIG.AUCTION_MAX_LISTINGS, CONFIG.AUCTION_START_LISTINGS + user.auction_level - 1);
    const open = db.prepare("SELECT COUNT(*) AS c FROM auction_listings WHERE seller_user_id=? AND status='OPEN'").get(userId) as { c: number };
    if (open.c >= cap) return { error: `Your nails on the board are full (${cap}).` };
    const inst = db.prepare("SELECT * FROM item_instances WHERE id=?").get(instanceId) as InstanceRow | undefined;
    if (!inst || inst.owner_user_id !== userId || (inst.location !== "INVENTORY" && inst.location !== "STORAGE")) {
      return { error: "You do not hold that piece." };
    }
    const feeRate = hours === 24 ? CONFIG.AUCTION_FEE_24H : CONFIG.AUCTION_FEE_12H;
    const fee = Math.max(1, Math.round(price * feeRate));
    if (!spendCoins(userId, fee, "AUCTION_FEE", `auction-${hours}h`, { instance: instanceId, price })) {
      return { error: `The crier demands ${fee} coins in fee.` };
    }
    db.prepare(
      "UPDATE item_instances SET location='AUCTION', owner_character_id=NULL, grid_x=NULL, grid_y=NULL, equip_slot=NULL WHERE id=?"
    ).run(inst.id);
    const id = uuid();
    const created = now();
    db.prepare(
      `INSERT INTO auction_listings (id,seller_user_id,seller_name,instance_id,price,fee_paid,duration_hours,created_at,expires_at,status)
       VALUES (?,?,?,?,?,?,?,?,?, 'OPEN')`
    ).run(id, userId, username, inst.id, price, fee, hours, created, created + hours * 3600 * 1000);
    return { error: null, fee };
  });
}

export function expireAuctions() {
  const t = now();
  const expired = db.prepare("SELECT * FROM auction_listings WHERE status='OPEN' AND expires_at < ?").all(t) as {
    id: string;
    seller_user_id: string;
    instance_id: string;
  }[];
  for (const e of expired) {
    tx(() => {
      db.prepare("UPDATE auction_listings SET status='EXPIRED' WHERE id=? AND status='OPEN'").run(e.id);
      const user = db.prepare("SELECT storage_level FROM users WHERE id=?").get(e.seller_user_id) as { storage_level: number } | undefined;
      if (!user) return;
      const items = loadStorage(e.seller_user_id);
      const { cols, rows } = storageGridSize(user.storage_level);
      const grid = buildGrid(items, cols, rows);
      const inst = db.prepare("SELECT * FROM item_instances WHERE id=?").get(e.instance_id) as InstanceRow;
      const spot = findPlace(grid, inst);
      if (spot) {
        db.prepare("UPDATE item_instances SET location='STORAGE', grid_x=?, grid_y=?, rotated=? WHERE id=?").run(
          spot.x,
          spot.y,
          spot.rotated,
          inst.id
        );
      } else {
        db.prepare("UPDATE item_instances SET location='STORAGE', grid_x=0, grid_y=0 WHERE id=?").run(inst.id);
      }
      db.prepare(
        "INSERT INTO auction_history (id,listing_id,seller_user_id,buyer_user_id,instance_id,price,outcome,created_at) VALUES (?,?,?,?,?,?,?,?)"
      ).run(uuid(), e.id, e.seller_user_id, null, e.instance_id, 0, "EXPIRED", now());
    });
  }
}

export function buyAuction(userId: string, listingId: string) {
  return tx(() => {
    expireAuctions();
    const { error, character } = requireAlive(userId);
    if (error || !character) return { error };
    if (character.location !== "CITY") return { error: "The board stands in the square." };
    const listing = db.prepare("SELECT * FROM auction_listings WHERE id=? AND status='OPEN'").get(listingId) as
      | {
          id: string;
          seller_user_id: string;
          seller_name: string;
          instance_id: string;
          price: number;
        }
      | undefined;
    if (!listing) return { error: "That nail has been pulled." };
    if (listing.seller_user_id === userId) return { error: "You cannot buy your own posting." };
    const locked = db.prepare("UPDATE auction_listings SET status='SOLD' WHERE id=? AND status='OPEN'").run(listing.id);
    if (locked.changes !== 1) return { error: "Another hand was faster." };
    const buyer = db.prepare("SELECT coins FROM users WHERE id=?").get(userId) as { coins: number };
    if (buyer.coins < listing.price) {
      db.prepare("UPDATE auction_listings SET status='OPEN' WHERE id=?").run(listing.id);
      return { error: "Not enough coins." };
    }
    const inst = db.prepare("SELECT * FROM item_instances WHERE id=?").get(listing.instance_id) as InstanceRow;
    const items = loadInv(String(character.id));
    const grid = buildGrid(items);
    const spot = findPlace(grid, inst);
    if (!spot) {
      db.prepare("UPDATE auction_listings SET status='OPEN' WHERE id=?").run(listing.id);
      return { error: "No space in the pack." };
    }
    spendCoins(userId, listing.price, "AUCTION_SALE", "auction-buy", { listing: listing.id });
    addCoins(listing.seller_user_id, listing.price, "AUCTION_SALE", "auction-sell", { listing: listing.id, buyer: userId });
    db.prepare(
      "UPDATE item_instances SET location='INVENTORY', owner_user_id=?, owner_character_id=?, grid_x=?, grid_y=?, rotated=? WHERE id=?"
    ).run(userId, character.id, spot.x, spot.y, spot.rotated, inst.id);
    db.prepare(
      "INSERT INTO auction_history (id,listing_id,seller_user_id,buyer_user_id,instance_id,price,outcome,created_at) VALUES (?,?,?,?,?,?,?,?)"
    ).run(uuid(), listing.id, listing.seller_user_id, userId, inst.id, listing.price, "SOLD", now());
    return { error: null };
  });
}

export function cancelAuction(userId: string, listingId: string) {
  return tx(() => {
    const { error, character } = requireAlive(userId);
    if (error || !character) return { error };
    const listing = db.prepare("SELECT * FROM auction_listings WHERE id=? AND seller_user_id=? AND status='OPEN'").get(listingId, userId) as
      | { id: string; instance_id: string }
      | undefined;
    if (!listing) return { error: "No such posting." };
    db.prepare("UPDATE auction_listings SET status='CANCELLED' WHERE id=?").run(listing.id);
    const inst = db.prepare("SELECT * FROM item_instances WHERE id=?").get(listing.instance_id) as InstanceRow;
    const items = loadInv(String(character.id));
    const grid = buildGrid(items);
    const spot = findPlace(grid, inst);
    if (spot) {
      db.prepare(
        "UPDATE item_instances SET location='INVENTORY', owner_character_id=?, grid_x=?, grid_y=?, rotated=? WHERE id=?"
      ).run(character.id, spot.x, spot.y, spot.rotated, inst.id);
    } else {
      const user = db.prepare("SELECT storage_level FROM users WHERE id=?").get(userId) as { storage_level: number };
      const st = loadStorage(userId);
      const g = storageGridSize(user.storage_level);
      const sgrid = buildGrid(st, g.cols, g.rows);
      const sspot = findPlace(sgrid, inst);
      db.prepare("UPDATE item_instances SET location='STORAGE', grid_x=?, grid_y=?, rotated=?, owner_character_id=NULL WHERE id=?").run(
        sspot?.x ?? 0,
        sspot?.y ?? 0,
        sspot?.rotated ?? 0,
        inst.id
      );
    }
    return { error: null };
  });
}

export function createGuild(userId: string, name: string, tag: string, description: string, emblem: string) {
  return tx(() => {
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(userId) as {
      highest_region: number;
      coins: number;
      guild_id: string | null;
    };
    if (user.guild_id) return { error: "You already fly a banner." };
    if (user.highest_region < CONFIG.GUILD_REQUIRED_REGION) {
      return { error: `Only wayfarers who have charted region ${CONFIG.GUILD_REQUIRED_REGION} may found a company.` };
    }
    if (!/^[A-Za-z][A-Za-z0-9 '.-]{2,23}$/.test(name) || !/^[A-Z0-9]{2,5}$/.test(tag)) {
      return { error: "Name 3–24 letters; tag 2–5 capitals." };
    }
    if (!spendCoins(userId, CONFIG.GUILD_CREATION_COST, "GUILD_CREATE", "guild", { name, tag })) {
      return { error: `Founding costs ${CONFIG.GUILD_CREATION_COST} coins.` };
    }
    const id = uuid();
    db.prepare("INSERT INTO guilds (id,name,tag,description,emblem,level,leader_user_id,created_at) VALUES (?,?,?,?,?,1,?,?)").run(
      id,
      name.trim(),
      tag,
      description.slice(0, 280),
      emblem || "wolf",
      userId,
      now()
    );
    db.prepare("INSERT INTO guild_members (guild_id,user_id,rank,joined_at) VALUES (?,?, 'leader', ?)").run(id, userId, now());
    db.prepare("UPDATE users SET guild_id=? WHERE id=?").run(id, userId);
    db.prepare("INSERT INTO guild_logs (id,guild_id,message,created_at) VALUES (?,?,?,?)").run(uuid(), id, `${name} is founded.`, now());
    return { error: null, id };
  });
}

export function joinGuild(userId: string, guildId: string) {
  return tx(() => {
    const user = db.prepare("SELECT guild_id FROM users WHERE id=?").get(userId) as { guild_id: string | null };
    if (user.guild_id) return { error: "Leave your current banner first." };
    const g = db.prepare("SELECT * FROM guilds WHERE id=?").get(guildId) as { id: string; level: number; name: string } | undefined;
    if (!g) return { error: "No such company." };
    const cap = CONFIG.GUILD_START_CAPACITY + (g.level - 1) * CONFIG.GUILD_CAPACITY_PER_LEVEL;
    const n = db.prepare("SELECT COUNT(*) AS c FROM guild_members WHERE guild_id=?").get(g.id) as { c: number };
    if (n.c >= cap) return { error: "The roster is full." };
    db.prepare("INSERT INTO guild_members (guild_id,user_id,rank,joined_at) VALUES (?,?, 'member', ?)").run(g.id, userId, now());
    db.prepare("UPDATE users SET guild_id=? WHERE id=?").run(g.id, userId);
    return { error: null };
  });
}

export function leaveGuild(userId: string) {
  return tx(() => {
    const user = db.prepare("SELECT guild_id FROM users WHERE id=?").get(userId) as { guild_id: string | null };
    if (!user.guild_id) return { error: "You fly no banner." };
    const g = db.prepare("SELECT leader_user_id FROM guilds WHERE id=?").get(user.guild_id) as { leader_user_id: string };
    db.prepare("DELETE FROM guild_members WHERE guild_id=? AND user_id=?").run(user.guild_id, userId);
    db.prepare("UPDATE users SET guild_id=NULL WHERE id=?").run(userId);
    if (g.leader_user_id === userId) {
      const next = db.prepare("SELECT user_id FROM guild_members WHERE guild_id=? LIMIT 1").get(user.guild_id) as { user_id: string } | undefined;
      if (next) db.prepare("UPDATE guilds SET leader_user_id=? WHERE id=?").run(next.user_id, user.guild_id);
    }
    return { error: null };
  });
}

export function upgradeGuild(userId: string) {
  return tx(() => {
    const user = db.prepare("SELECT guild_id FROM users WHERE id=?").get(userId) as { guild_id: string | null };
    if (!user.guild_id) return { error: "No company." };
    const g = db.prepare("SELECT * FROM guilds WHERE id=?").get(user.guild_id) as { id: string; level: number; leader_user_id: string };
    if (g.leader_user_id !== userId) return { error: "Only the captain may pay for walls." };
    if (g.level >= CONFIG.GUILD_MAX_LEVEL) return { error: "The hall is finished." };
    const cost = CONFIG.GUILD_UPGRADE_BASE * g.level;
    if (!spendCoins(userId, cost, "UPGRADE", "guild-level")) return { error: "Not enough coins." };
    db.prepare("UPDATE guilds SET level = level + 1 WHERE id=?").run(g.id);
    return { error: null };
  });
}

export function forgeCostFor(rarity: string) {
  if (rarity === "Mythic") return null;
  const n = CONFIG.FORGE_COST[rarity];
  return n ?? null;
}

export function forgeItems(userId: string, instanceIds: string[]) {
  return tx(() => {
    const { error, character } = requireAlive(userId);
    if (error || !character) return { error: error || "No character" };
    if (character.location !== "CITY") return { error: "The forge burns only in the city." };
    const ids = [...new Set(instanceIds.map(String))].filter(Boolean);
    if (ids.length !== 3) return { error: "The anvil wants three of the same piece." };
    const rows = ids.map(
      (id) => db.prepare("SELECT * FROM item_instances WHERE id = ?").get(id) as InstanceRow | undefined
    );
    if (rows.some((r) => !r || r.destroyed_at)) return { error: "The item is gone." };
    const items = rows as InstanceRow[];
    for (const inst of items) {
      if (inst.owner_user_id !== userId || inst.owner_character_id !== character.id) return { error: "That is not yours." };
      if (inst.location !== "INVENTORY") return { error: "Forge only what sits in the pack." };
    }
    const defId = items[0]!.definition_id;
    const rarity = items[0]!.rarity;
    if (items.some((i) => i.definition_id !== defId || i.rarity !== rarity)) {
      return { error: "Those three are not the same." };
    }
    const idx = RARITIES.indexOf(rarity as (typeof RARITIES)[number]);
    const next = idx >= 0 ? RARITIES[idx + 1] : undefined;
    if (!next) return { error: "That rarity cannot be hammered higher." };
    const cost = forgeCostFor(rarity);
    if (cost == null) return { error: "That rarity cannot be hammered higher." };
    const oreKey = oreIdForRarity(rarity);
    if (!oreKey) return { error: "That rarity cannot be hammered higher." };
    const oreDef = ORE_META[oreKey].defId;
    const ore = loadInv(String(character.id)).find((i) => i.definition_id === oreDef && !ids.includes(i.id));
    if (!ore) return { error: "The anvil wants matching ore." };
    const defRow = db.prepare("SELECT category FROM item_definitions WHERE id=?").get(defId) as { category: string } | undefined;
    if (defRow?.category === "ore") return { error: "Ore is not forged. It feeds the hammer." };
    if (!spendCoins(userId, cost, "FORGE", "forge", { keep: items[0]!.id, rarity, next })) {
      return { error: "Not enough coins." };
    }
    destroyInstance(ore.id);
    const keep = items[0]!;
    destroyInstance(items[1]!.id);
    destroyInstance(items[2]!.id);
    db.prepare("UPDATE item_instances SET rarity = ? WHERE id = ?").run(next, keep.id);
    keep.rarity = next;
    rerollInstanceFromDefinition(keep);
    logGame("FORGE", `${keep.definition_id} ${rarity} -> ${next}`, userId);
    return { error: null, item: hydrate(keep), cost, rarity: next };
  });
}

export function adminLedger() {
  const accounts = db
    .prepare(
      `SELECT u.id AS user_id, u.username, u.email, u.role, u.coins, u.highest_region,
              c.id AS character_id, c.name AS character_name, c.class AS character_class,
              c.level, c.region, c.round, c.location
       FROM users u
       LEFT JOIN characters c ON c.user_id = u.id AND c.status = 'ALIVE'
       ORDER BY u.username COLLATE NOCASE`
    )
    .all();
  const guilds = db
    .prepare(
      `SELECT g.id, g.name, g.tag, g.level, g.emblem, g.created_at,
              u.username AS leader_name,
              (SELECT COUNT(*) FROM guild_members m WHERE m.guild_id = g.id) AS members
       FROM guilds g
       JOIN users u ON u.id = g.leader_user_id
       ORDER BY g.level DESC, g.name COLLATE NOCASE`
    )
    .all();
  return { accounts, guilds };
}

export function adminAdjustCoins(userId: string, delta: number) {
  const amount = Math.trunc(Number(delta));
  if (!Number.isFinite(amount) || amount === 0) return { error: "Name a coin amount." as const, coins: null };
  const u = db.prepare("SELECT coins FROM users WHERE id=?").get(userId) as { coins: number } | undefined;
  if (!u) return { error: "No such account." as const, coins: null };
  const next = Math.max(0, u.coins + amount);
  const applied = next - u.coins;
  if (applied === 0) return { error: null, coins: u.coins };
  addCoins(userId, applied, "ADMIN", applied > 0 ? "grant" : "levy");
  logGame("ADMIN", `coins ${applied > 0 ? "+" : ""}${applied} → ${next}`, userId);
  return { error: null, coins: next };
}

export function adminEraseCharacter(characterId: string) {
  return tx(() => {
    const c = db.prepare("SELECT * FROM characters WHERE id=?").get(characterId) as
      | { id: string; name: string; user_id: string }
      | undefined;
    if (!c) return { error: "No such wayfarer." as const };
    const items = db.prepare("SELECT id FROM item_instances WHERE owner_character_id=?").all(c.id) as { id: string }[];
    for (const it of items) destroyInstance(it.id);
    clearGround(c.id);
    db.prepare("DELETE FROM character_skills WHERE character_id=?").run(c.id);
    db.prepare("DELETE FROM ground_loot WHERE character_id=?").run(c.id);
    db.prepare("DELETE FROM characters WHERE id=?").run(c.id);
    logGame("ADMIN", `erased wayfarer ${c.name}`, c.user_id);
    return { error: null };
  });
}

export function adminDisbandGuild(guildId: string) {
  return tx(() => {
    const g = db.prepare("SELECT id, name FROM guilds WHERE id=?").get(guildId) as { id: string; name: string } | undefined;
    if (!g) return { error: "No such company." as const };
    db.prepare("UPDATE users SET guild_id=NULL WHERE guild_id=?").run(g.id);
    db.prepare("DELETE FROM guilds WHERE id=?").run(g.id);
    logGame("ADMIN", `disbanded company ${g.name}`);
    return { error: null };
  });
}

export function adminDropTables() {
  return loadDropConfig();
}

export function adminSaveDropTables(raw: unknown) {
  const cfg = saveDropConfig(raw);
  logGame("ADMIN", "loot rarity tables saved");
  return cfg;
}

export function adminResetDropTables() {
  const cfg = saveDropConfig(defaultDropConfig());
  logGame("ADMIN", "loot rarity tables reset");
  return cfg;
}

export function adminShopTables() {
  return loadShopConfig();
}

export function adminSaveShopTables(raw: unknown) {
  const cfg = saveShopConfig(raw);
  logGame("ADMIN", "shop rarity tables saved");
  return cfg;
}

export function adminResetShopTables() {
  const cfg = saveShopConfig(defaultShopConfig());
  logGame("ADMIN", "shop rarity tables reset");
  return cfg;
}

export function adminXp() {
  return loadXpConfig();
}

export function adminSaveXp(raw: unknown) {
  const cfg = saveXpConfig(raw);
  logGame("ADMIN", "kill experience saved");
  return cfg;
}

export function adminResetXp() {
  const cfg = saveXpConfig(defaultXpConfig());
  logGame("ADMIN", "kill experience reset");
  return cfg;
}

export function adminMapGlobals() {
  return loadMapGlobals();
}

export function adminSaveMapGlobals(raw: unknown) {
  const cfg = saveMapGlobals(raw);
  logGame("ADMIN", "map globals saved");
  return cfg;
}

export function adminResetMapGlobals() {
  const cfg = saveMapGlobals(defaultMapGlobals());
  logGame("ADMIN", "map globals reset");
  return cfg;
}

export function adminPackTables() {
  return loadPackConfig();
}

export function adminSavePackTables(raw: unknown) {
  const cfg = savePackConfig(raw);
  logGame("ADMIN", "pack odds tables saved");
  return cfg;
}

export function adminResetPackTables() {
  const cfg = savePackConfig(defaultPackConfig());
  logGame("ADMIN", "pack odds tables reset");
  return cfg;
}

export function adminMineTables() {
  return loadMineConfig();
}

export function adminSaveMineTables(raw: unknown) {
  const cfg = saveMineConfig(raw);
  logGame("ADMIN", "mine tables saved");
  return cfg;
}

export function adminResetMineTables() {
  const cfg = saveMineConfig(defaultMineConfig());
  logGame("ADMIN", "mine tables reset");
  return cfg;
}

export function itemCatalog() {
  return loadItemCatalog();
}

export function enemyCatalog() {
  return loadEnemyCatalog();
}

export function heroCatalog() {
  return loadHeroCatalog();
}

export function heroRoster() {
  return publicHeroes();
}

export function adminSaveHero(raw: Record<string, unknown>) {
  const r = writeHero(raw);
  if (!r.error) logGame("ADMIN", `saved hero ${r.id}`);
  return r;
}

export function adminItemIcons() {
  return listItemIcons();
}

export function adminHeroIcons() {
  return listAssetIcons("pers");
}

export function adminMobIcons() {
  return listAssetIcons("mob");
}

export function adminSaveItemIcon(dataUrl: string) {
  return saveUploadedIcon(dataUrl);
}

export function adminSaveHeroIcon(dataUrl: string) {
  return saveUploadedAsset(dataUrl, "pers");
}

export function adminSaveMobIcon(dataUrl: string) {
  return saveUploadedAsset(dataUrl, "mob");
}

export function adminSets() {
  return db.prepare("SELECT id, name FROM item_sets ORDER BY name COLLATE NOCASE").all() as { id: string; name: string }[];
}

export function adminSellPct() {
  return { pct: loadSellPct() };
}

export function adminSaveSellPct(raw: unknown) {
  const pct = saveSellPct(raw);
  logGame("ADMIN", `sell percent ${pct}`);
  return { pct };
}

export function adminItemDefs() {
  const rows = db
    .prepare(
      `SELECT id, name, category, slot, rarity_min, required_level, set_id, glyph, flavor, tags, base_stats, icon, base_value, value_by_rarity
       FROM item_definitions ORDER BY required_level, name COLLATE NOCASE`
    )
    .all() as Record<string, unknown>[];
  return rows.map((row) => {
    const tags = JSON.parse(String(row.tags || "[]")) as string[];
    const school = tags.includes("chain") ? "chain" : tags.includes("fire") ? "fire" : tags.includes("frost") ? "frost" : "";
    const valueByRarity = parseValueByRarity(row.value_by_rarity);
    const legacyValue = Math.max(0, Math.trunc(Number(row.base_value) || 0));
    const anyPriced = RARITIES.some((r) => (valueByRarity[r] || 0) > 0);
    return {
      id: String(row.id),
      slot: row.slot ? String(row.slot) : null,
      rarity_min: String(row.rarity_min),
      required_level: Number(row.required_level) || 1,
      set_id: row.set_id ? String(row.set_id) : null,
      icon: String(row.icon || ""),
      twohand: tags.includes("twohand"),
      school,
      value_by_rarity: anyPriced
        ? valueByRarity
        : (Object.fromEntries(RARITIES.map((r) => [r, legacyValue])) as Record<Rarity, number>),
      base_stats: sanitizeStats(
        (parseStatsByRarity(row.base_stats)?.Common || JSON.parse(String(row.base_stats || "{}"))) as Stats
      ),
      stats_by_rarity: Object.fromEntries(
        RARITIES.map((r) => [
          r,
          parseStatsByRarity(row.base_stats)?.[r] ||
            sanitizeStats((() => {
              try {
                const raw = JSON.parse(String(row.base_stats || "{}"));
                return raw && typeof raw === "object" && !raw.Common ? raw : {};
              } catch {
                return {};
              }
            })() as Stats),
        ])
      ) as Record<Rarity, Stats>,
      i18n: localesFor(String(row.id)),
    };
  });
}

function inferCategory(slot: string | null, prev?: string) {
  if (!slot) return "ore";
  if (slot === "Weapon") return "weapon";
  if (slot === "Neck" || slot === "Ring1" || slot === "Ring2") return "jewelry";
  return prev === "weapon" && slot === "Offhand" ? "weapon" : "armor";
}

function defaultGlyph(slot: string | null) {
  if (!slot) return "stone";
  if (slot === "Weapon") return "sword";
  if (slot === "Offhand") return "shield";
  if (slot === "Head") return "helm";
  if (slot === "Chest") return "chest";
  if (slot === "Gloves") return "gloves";
  if (slot === "Legs") return "legs";
  if (slot === "Boots") return "boots";
  if (slot === "Neck") return "neck";
  return "ring";
}

export function adminSaveItemDef(raw: Record<string, unknown>) {
  const id = String(raw.id || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  if (!id) return { error: "Name an item id." as const };
  const names = (raw.names && typeof raw.names === "object" ? raw.names : {}) as Record<string, string>;
  const flavors = (raw.flavors && typeof raw.flavors === "object" ? raw.flavors : {}) as Record<string, string>;
  const name = String(names.en || names.ru || names.zh || raw.name || "").trim().slice(0, 80);
  if (name.length < 2) return { error: "Name the piece." as const };
  const slots = ["Head", "Chest", "Gloves", "Legs", "Boots", "Weapon", "Offhand", "Neck", "Ring1", "Ring2"];
  const slotRaw = String(raw.slot || "");
  const slot = slotRaw && slots.includes(slotRaw) ? slotRaw : null;
  const rarity = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"].includes(String(raw.rarity_min))
    ? String(raw.rarity_min)
    : "Common";
  const req = Math.max(1, Math.trunc(Number(raw.required_level) || 1));
  const prev = db.prepare("SELECT * FROM item_definitions WHERE id=?").get(id) as
    | { category: string; glyph: string; tags: string; sell_mult: number; set_id: string | null; base_value: number; value_by_rarity: string }
    | undefined;
  const category = inferCategory(slot, prev?.category);
  const flavor = String(flavors.en || flavors.ru || flavors.zh || "").slice(0, 240);
  let setId = raw.set_id ? String(raw.set_id) : null;
  if (setId && !db.prepare("SELECT id FROM item_sets WHERE id=?").get(setId)) setId = null;
  const prevTags = prev ? (JSON.parse(prev.tags || "[]") as string[]) : [];
  const keep = prevTags.filter((t) => !["magic", "chain", "fire", "frost", "ore", "twohand"].includes(t));
  const school = ["chain", "fire", "frost"].includes(String(raw.school)) ? String(raw.school) : "";
  if (!slot) keep.push("ore");
  if (school) keep.push("magic", school);
  if (raw.twohand) keep.push("twohand");
  const glyph = prev?.glyph || defaultGlyph(slot);
  const icon = normalizeIcon(raw.icon);
  const byRarity = (raw.stats_by_rarity && typeof raw.stats_by_rarity === "object" ? raw.stats_by_rarity : null) as
    | Partial<Record<Rarity, Record<string, number>>>
    | null;
  const incoming = raw.base_stats && typeof raw.base_stats === "object" ? (raw.base_stats as Record<string, number>) : {};
  const rarityStats: Partial<Record<Rarity, Stats>> = {};
  if (byRarity) {
    for (const r of RARITIES) {
      const row = byRarity[r] && typeof byRarity[r] === "object" ? byRarity[r]! : {};
      const stats: Stats = {};
      for (const k of STAT_KEYS) {
        const n = Number(row[k]);
        if (Number.isFinite(n) && n) stats[k] = n;
      }
      rarityStats[r] = sanitizeStats(stats);
    }
  } else {
    const stats: Stats = {};
    for (const k of STAT_KEYS) {
      const n = Number(incoming[k]);
      if (Number.isFinite(n) && n) stats[k] = n;
    }
    rarityStats.Common = sanitizeStats(stats);
  }
  const clean = rarityStats.Common || {};
  const stored = JSON.stringify(byRarity ? rarityStats : clean);
  const valueByRarity = parseValueByRarity(raw.value_by_rarity);
  const baseValue = valueByRarity.Common || RARITIES.reduce((n, r) => n || valueByRarity[r], 0);
  db.prepare(
    `INSERT INTO item_definitions (id,name,category,slot,rarity_min,base_level,required_level,width,height,stackable,max_stack,base_stats,affix_pool,set_id,glyph,flavor,tags,sell_mult,icon,base_value,value_by_rarity)
     VALUES (?,?,?,?,?,?,?,1,1,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, category=excluded.category, slot=excluded.slot, rarity_min=excluded.rarity_min,
       base_level=excluded.base_level, required_level=excluded.required_level, width=1, height=1,
       base_stats=excluded.base_stats, set_id=excluded.set_id, flavor=excluded.flavor,
       tags=excluded.tags, icon=excluded.icon, base_value=excluded.base_value, value_by_rarity=excluded.value_by_rarity`
  ).run(
    id,
    name,
    category,
    slot,
    rarity,
    req,
    req,
    0,
    1,
    stored,
    JSON.stringify([]),
    setId,
    glyph,
    flavor,
    JSON.stringify(keep),
    prev?.sell_mult ?? 1,
    icon,
    baseValue,
    JSON.stringify(valueByRarity)
  );
  saveItemI18n(id, names, flavors);
  const inst = db.prepare("SELECT * FROM item_instances WHERE definition_id = ? AND location != 'DESTROYED'").all(id) as InstanceRow[];
  for (const row of inst) {
    db.prepare("UPDATE item_instances SET required_level = ? WHERE id = ?").run(req, row.id);
    row.required_level = req;
    rerollInstanceFromDefinition(row);
  }
  logGame("ADMIN", `item def ${id}`);
  return { error: null, id };
}

export function adminDeleteItemDef(id: string) {
  const defId = String(id || "");
  if (!defId) return { error: "No such piece." as const };
  const used = db.prepare("SELECT COUNT(*) AS c FROM item_instances WHERE definition_id = ? AND location != 'DESTROYED'").get(defId) as { c: number };
  if (used.c > 0) return { error: "That piece still walks the road." as const };
  db.prepare("DELETE FROM item_i18n WHERE definition_id=?").run(defId);
  db.prepare("DELETE FROM item_definitions WHERE id=?").run(defId);
  logGame("ADMIN", `deleted item def ${defId}`);
  return { error: null };
}

export function adminGate() {
  return loadGate();
}

export function adminSaveGate(raw: unknown) {
  const gate = saveGate(raw);
  logGame("ADMIN", `gate ${gate.version}${gate.maintenance ? " closed" : " open"}`);
  return gate;
}

const ENEMY_KINDS = ["normal", "elite", "boss"] as const;
const ENEMY_GLYPHS = ["bandit", "beast", "knight", "undead", "witch", "cultist", "necromancer", "orc"];
const ENEMY_ABILITIES = ["heavy", "regen", "bleed", "poison", "fire"];

function syncEnemyPools(id: string, region: number, kind: string) {
  const rows = db.prepare("SELECT id, enemy_pool, elite_pool, boss_id FROM regions").all() as {
    id: number;
    enemy_pool: string;
    elite_pool: string;
    boss_id: string;
  }[];
  const up = db.prepare("UPDATE regions SET enemy_pool=?, elite_pool=?, boss_id=? WHERE id=?");
  for (const r of rows) {
    const normals = parseIdList(r.enemy_pool).filter((x) => x !== id);
    const elites = parseIdList(r.elite_pool).filter((x) => x !== id);
    let boss = r.boss_id === id ? "" : r.boss_id;
    if (r.id === region) {
      if (kind === "normal") normals.push(id);
      if (kind === "elite") elites.push(id);
      if (kind === "boss") boss = id;
    }
    if (!boss) {
      const fallback = db
        .prepare("SELECT id FROM enemies WHERE region=? AND kind='boss' AND id!=? LIMIT 1")
        .get(r.id, id) as { id: string } | undefined;
      boss = fallback?.id || boss;
    }
    up.run(JSON.stringify(normals), JSON.stringify(elites), boss, r.id);
  }
}

export function adminRegions() {
  return db.prepare("SELECT id, name, slug FROM regions ORDER BY id").all() as { id: number; name: string; slug: string }[];
}

export function adminEnemyDefs() {
  const rows = db
    .prepare(
      `SELECT id, name, kind, hp, damage, armor, crit_chance, attack_speed, dodge, abilities, loot_table, region, glyph, icon
       FROM enemies ORDER BY region, kind, name COLLATE NOCASE`
    )
    .all() as Record<string, unknown>[];
  return rows.map((row) => {
    const loot = parseEnemyLoot(String(row.loot_table || "{}"));
    const abilities = (JSON.parse(String(row.abilities || "[]")) as string[]).filter((a) => a !== "strike" && a !== "undead");
    return {
      id: String(row.id),
      kind: String(row.kind),
      hp: Number(row.hp) || 1,
      damage: Number(row.damage) || 0,
      armor: Number(row.armor) || 0,
      crit_chance: Number(row.crit_chance) || 0,
      dodge: Number(row.dodge) || 0,
      abilities,
      undead: !!loot.undead,
      region: Number(row.region) || 1,
      glyph: String(row.glyph || "bandit"),
      icon: String(row.icon || loot.icon || ""),
      potency: {
        regen: Number(loot.regen ?? 2),
        poison: Number(loot.poison ?? 4),
        poisonChance: Number(loot.poisonChance ?? 40),
        bleed: Number(loot.bleed ?? 4),
        bleedChance: Number(loot.bleedChance ?? 40),
        fireDmg: Number(loot.fireDmg ?? 4),
        fireHits: Number(loot.fireHits ?? 3),
        fireChance: Number(loot.fireChance ?? 30),
        heavyPct: Number(loot.heavyPct ?? 20),
      },
      i18n: localesForEnemy(String(row.id)),
    };
  });
}

export function adminSaveEnemy(raw: Record<string, unknown>) {
  const id = String(raw.id || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  if (!id) return { error: "Name a creature id." as const };
  const names = (raw.names && typeof raw.names === "object" ? raw.names : {}) as Record<string, string>;
  const name = String(names.en || names.ru || names.zh || raw.name || "").trim().slice(0, 80);
  if (name.length < 2) return { error: "Name the creature." as const };
  const kind = ENEMY_KINDS.includes(String(raw.kind) as (typeof ENEMY_KINDS)[number])
    ? String(raw.kind)
    : "normal";
  const regions = adminRegions();
  const regionIds = regions.map((r) => r.id);
  const region = regionIds.includes(Number(raw.region)) ? Number(raw.region) : regionIds[0] || 1;
  const glyph = ENEMY_GLYPHS.includes(String(raw.glyph)) ? String(raw.glyph) : String(raw.glyph || "bandit").slice(0, 24) || "bandit";
  const hp = Math.max(1, Math.trunc(Number(raw.hp) || 50));
  const damage = Math.max(0, Math.trunc(Number(raw.damage) || 0));
  const armor = Math.max(0, Math.trunc(Number(raw.armor) || 0));
  const crit = Math.min(1, Math.max(0, Number(raw.crit_chance) || 0));
  const dodge = Math.min(1, Math.max(0, Number(raw.dodge) || 0));
  const incoming = Array.isArray(raw.abilities) ? raw.abilities.map(String) : [];
  const abilities = ENEMY_ABILITIES.filter((a) => incoming.includes(a));
  const undead = !!raw.undead || glyph === "undead";
  const pot = (raw.potency && typeof raw.potency === "object" ? raw.potency : {}) as Record<string, number>;
  const num = (k: string, d: number) => {
    const n = Number(pot[k]);
    return Number.isFinite(n) && n >= 0 ? n : d;
  };
  const icon = normalizeIcon(raw.icon);
  const loot: EnemyLoot = {
    undead,
    icon,
    regen: num("regen", 2),
    poison: num("poison", 4),
    poisonChance: Math.min(100, num("poisonChance", 40)),
    bleed: num("bleed", 4),
    bleedChance: Math.min(100, num("bleedChance", 40)),
    fireDmg: num("fireDmg", 4),
    fireHits: Math.max(1, Math.trunc(num("fireHits", 3))),
    fireChance: Math.min(100, num("fireChance", 30)),
    heavyPct: num("heavyPct", 20),
  };
  const prev = db.prepare("SELECT kind, region FROM enemies WHERE id=?").get(id) as { kind: string; region: number } | undefined;
  if (prev?.kind === "boss" && kind !== "boss") {
    const other = db
      .prepare("SELECT id FROM enemies WHERE region=? AND kind='boss' AND id!=? LIMIT 1")
      .get(prev.region, id) as { id: string } | undefined;
    if (!other) return { error: "Keep one boss on that depth." as const };
  }
  db.prepare(
    `INSERT INTO enemies (id,name,kind,hp,damage,armor,crit_chance,attack_speed,dodge,abilities,loot_table,region,glyph,icon)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, kind=excluded.kind, hp=excluded.hp, damage=excluded.damage, armor=excluded.armor,
       crit_chance=excluded.crit_chance, dodge=excluded.dodge,
       abilities=excluded.abilities, loot_table=excluded.loot_table, region=excluded.region, glyph=excluded.glyph, icon=excluded.icon`
  ).run(
    id,
    name,
    kind,
    hp,
    damage,
    armor,
    crit,
    1,
    dodge,
    JSON.stringify(abilities),
    JSON.stringify(loot),
    region,
    glyph,
    icon
  );
  saveEnemyI18n(id, names);
  syncEnemyPools(id, region, kind);
  logGame("ADMIN", `enemy ${id} ${kind} d${region}`);
  return { error: null, id };
}

export function adminDeleteEnemy(id: string) {
  const enemyId = String(id || "");
  if (!enemyId) return { error: "No such creature." as const };
  const row = db.prepare("SELECT id, region, kind FROM enemies WHERE id=?").get(enemyId) as
    | { id: string; region: number; kind: string }
    | undefined;
  if (!row) return { error: "No such creature." as const };
  if (row.kind === "boss") {
    const other = db
      .prepare("SELECT id FROM enemies WHERE region=? AND kind='boss' AND id!=? LIMIT 1")
      .get(row.region, enemyId) as { id: string } | undefined;
    if (!other) return { error: "Keep one boss on that depth." as const };
  }
  db.prepare("DELETE FROM enemy_i18n WHERE enemy_id=?").run(enemyId);
  db.prepare("DELETE FROM enemies WHERE id=?").run(enemyId);
  syncEnemyPools(enemyId, -1, "");
  logGame("ADMIN", `deleted enemy ${enemyId}`);
  return { error: null };
}

export { storageCapacity, storageGridSize, loadStorage, characterPower };
