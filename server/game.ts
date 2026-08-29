import { v4 as uuid } from "uuid";
import { db, now, tx } from "./db.ts";
import { CONFIG } from "./config.ts";
import { CLASS_BASE, emptyStats, EQUIP_SLOTS, RARITIES, type Stats } from "./engine/stats.ts";
import { generateInstance, hydrate, destroyInstance, itemValue, rerollInstanceFromDefinition, type InstanceRow } from "./engine/items.ts";
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
import { applyTalentPick, canPickTalent, ensureTalentTree, freshTalentTree } from "./engine/talents.ts";
import {
  combatKind,
  generateMarch,
  parseMarch,
  reachableIds,
  rollMystery,
  toPublicMarch,
  type MarchState,
  type ResolvedKind,
} from "./engine/march.ts";

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
  const hp = Math.min(Number(character.hp ?? power.maxHp), power.maxHp);
  db.prepare("UPDATE characters SET max_hp=?, hp=? WHERE id=?").run(power.maxHp, hp, character.id);
  return { power, hp };
}

export function snapshotCharacter(c: Record<string, unknown>) {
  fillMissingSlots(String(c.id));
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
  c = { ...c, depth: Number(c.depth || 0), round: Number(c.round || 1) };
  return {
    character: { ...c, power, talent_points: talentPoints, depth: Number(c.depth || 0) },
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
    packOdds: packOddsFor(Number(c.depth || 0)),
  };
}

export function createCharacter(userId: string, name: string, cls: string) {
  const alive = db.prepare("SELECT id FROM characters WHERE user_id = ? AND status = 'ALIVE'").get(userId);
  if (alive) return { error: "You already have a living wayfarer." };
  if (!CLASS_BASE[cls as keyof typeof CLASS_BASE]) return { error: "Unknown calling." };
  if (!/^[A-Za-z][A-Za-z0-9 _-]{2,19}$/.test(name)) return { error: "A proper name, three to twenty letters." };
  const taken = db.prepare("SELECT id FROM characters WHERE name = ? COLLATE NOCASE").get(name);
  if (taken) return { error: "That name is already carved." };
  const base = CLASS_BASE[cls as keyof typeof CLASS_BASE];
  const id = uuid();
  const hp = base.health;
  const march = generateMarch();
  db.prepare(
    `INSERT INTO characters (id,user_id,name,class,level,xp,region,round,hp,max_hp,status,location,created_at)
     VALUES (?,?,?,?,1,0,1,1,?,?, 'ALIVE','WILD',?)`
  ).run(id, userId, name.trim(), cls, hp, hp, now());
  db.prepare("UPDATE characters SET talent_tree = ?, talent_points = 0, depth = 0, map_state = ? WHERE id = ?").run(
    JSON.stringify(freshTalentTree()),
    JSON.stringify(march),
    id
  );
  const starters: Record<string, string[]> = {
    Ironclad: ["peat_shortsword", "wood_buckler", "padded_jack", "iron_cap"],
    Shadehand: ["ash_knife", "ash_wand", "wool_hood", "hide_jerkin", "clogs"],
    Thornbow: ["briar_bow", "wool_hood", "padded_jack", "hunter_knife"],
  };
  const items = starters[cls] || starters.Ironclad;
  const inv: InstanceRow[] = [];
  for (const defId of items!) {
    const inst = generateInstance({
      definitionId: defId,
      ownerUserId: userId,
      ownerCharacterId: id,
      location: "INVENTORY",
      region: 1,
      forceRarity: "Common",
    });
    inv.push(inst);
  }
  const grid = buildGrid([]);
  for (const it of inv) {
    const spot = findPlace(grid, it);
    if (spot) {
      db.prepare("UPDATE item_instances SET grid_x=?, grid_y=?, rotated=? WHERE id=?").run(spot.x, spot.y, spot.rotated, it.id);
      grid[spot.y]![spot.x] = it.id;
    }
  }
  return { error: null, id };
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

function ensureSideCity(state: MarchState) {
  const cities = state.nodes.filter((n) => n.kind === "city");
  if (cities.length >= 2) return false;
  const pool = state.nodes.filter(
    (n) =>
      n.floor !== 1 &&
      n.floor !== 5 &&
      n.floor !== 10 &&
      n.kind !== "city" &&
      n.kind !== "boss" &&
      !state.visited.includes(n.id) &&
      n.id !== state.current &&
      n.id !== state.pending
  );
  if (!pool.length) return false;
  pool[Math.floor(Math.random() * pool.length)]!.kind = "city";
  return true;
}

function saveMarch(characterId: unknown, state: MarchState) {
  db.prepare("UPDATE characters SET map_state = ? WHERE id = ?").run(JSON.stringify(state), characterId);
}

function ensureMarch(character: Record<string, unknown>): MarchState {
  let state = parseMarch(character.map_state);
  if (!state) {
    state = generateMarch();
    if (character.location === "CITY") {
      const city = state.nodes.find((n) => n.kind === "city" && n.floor === 5) || state.nodes.find((n) => n.kind === "city");
      if (city) {
        state.current = city.id;
        state.visited = [city.id];
        db.prepare("UPDATE characters SET round = 5 WHERE id = ?").run(character.id);
      }
    }
    saveMarch(character.id, state);
    character.map_state = JSON.stringify(state);
  } else if (ensureSideCity(state)) {
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
    const depth = Number(character.depth || 0) + 1;
    const region = Math.min(10, Math.max(1, depth + 1));
    const fresh = generateMarch();
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
};

function toFoe(enemy: EnemyRow) {
  const lootTable = JSON.parse(enemy.loot_table || "{}") as { undead?: boolean };
  const abilities = JSON.parse(enemy.abilities || "[]") as string[];
  return {
    id: String(enemy.id),
    name: enemy.name,
    hp: enemy.hp,
    maxHp: enemy.hp,
    undead: !!lootTable.undead,
    stats: {
      ...emptyStats(),
      health: enemy.hp,
      damage: enemy.damage,
      armor: enemy.armor,
      critChance: enemy.crit_chance * 100,
      critDamage: 150,
      dodge: enemy.dodge * 100,
      regen: abilities.includes("regen") ? 2 : 0,
      bleed: abilities.includes("bleed") ? 4 : 0,
      bleedChance: abilities.includes("bleed") ? 40 : 0,
      poison: abilities.includes("poison") ? 4 : 0,
      poisonChance: abilities.includes("poison") ? 40 : 0,
    },
  };
}

function pickEncounter(regionId: number, kind: "normal" | "elite" | "boss", depth: number): EnemyRow[] {
  const enemy = pickEnemy(regionId, kind) as EnemyRow;
  const pack = [enemy];
  if (kind === "normal") {
    const extra = rollPackExtra(depth);
    const region = db.prepare("SELECT enemy_pool FROM regions WHERE id = ?").get(regionId) as { enemy_pool: string };
    const pool = JSON.parse(region.enemy_pool || "[]") as string[];
    for (let i = 0; i < extra; i++) {
      const id = pool[Math.floor(Math.random() * pool.length)];
      const add = db.prepare("SELECT * FROM enemies WHERE id = ?").get(id) as EnemyRow | undefined;
      if (add) pack.push(add);
    }
  }
  return pack;
}

function packView(pack: EnemyRow[]) {
  return pack.map((e, i) => ({
    id: `${e.id}#${i}`,
    name: e.name,
    kind: e.kind,
    hp: e.hp,
    maxHp: e.hp,
    damage: e.damage,
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
    depth: Number(character.depth || 0),
  });
  addCoins(userId, loot.gold, "LOOT_REWARD", ref, { region: character.region, round: character.round });
  db.prepare("UPDATE characters SET gold_earned = gold_earned + ?, loot_pending=? WHERE id=?").run(
    loot.gold,
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
      depth: Number(character.depth || 0),
    });
    addCoins(userId, loot.gold, "LOOT_REWARD", `combat:${enemy.id}`, { region: character.region, round: character.round });
    const xpGain = 12 + Number(character.region) * 4 + (enemy.kind === "boss" ? 40 : enemy.kind === "elite" ? 18 : 0);
    let level = Number(character.level);
    let xp = Number(character.xp) + xpGain;
    let needed = 40 + level * 25;
    while (xp >= needed) {
      xp -= needed;
      level++;
      needed = 40 + level * 25;
    }
    const newMax = characterPower({ id: String(character.id), class: String(character.class), level }).maxHp;
    const talentGain = enemy.kind === "boss" ? 1 : 0;
    db.prepare(
      `UPDATE characters SET hp=?, max_hp=?, level=?, xp=?, enemies_defeated = enemies_defeated + 1, gold_earned = gold_earned + ?, loot_pending=?, talent_points = COALESCE(talent_points, 0) + ? WHERE id=?`
    ).run(
      Math.min(newMax, result.playerHp + Math.round(newMax * 0.15)),
      newMax,
      level,
      xp,
      loot.gold,
      JSON.stringify(loot.items.map((it) => it.id)),
      talentGain,
      character.id
    );
    if (!loot.items.length) finishPendingNode({ ...character, loot_pending: "[]" });
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
    const fight = runCombat(userId, character, pf.kind, pack);
    if (fight.error) return fight;
    return { error: null, action: "fight" as const, ...(fight.result ?? {}) };
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
    } else if (node.kind === "monster" || node.kind === "elite" || node.kind === "boss" || node.kind === "city") {
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
      db.prepare("UPDATE characters SET location='CITY', hp=?, max_hp=? WHERE id=?").run(power.maxHp, power.maxHp, character.id);
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
    const pack = pickEncounter(Number(character.region), ck, Number(character.depth || 0));
    state.pendingFight = { kind: ck, enemyIds: pack.map((e) => e.id) };
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
    finishPendingNode(row);
    return { error: null };
  });
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
  db.prepare("UPDATE characters SET location='WILD' WHERE id=?").run(character.id);
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

export function shopState(userId: string) {
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(userId) as { shop_level: number; coins: number };
  const slots = Math.min(CONFIG.SHOP_MAX_ITEMS, CONFIG.SHOP_START_ITEMS + user.shop_level - 1);
  let rows = db.prepare("SELECT * FROM shop_items WHERE user_id=?").all(userId) as { id: string; instance_id: string; price: number; slot: number }[];
  if (rows.length === 0) {
    refreshShop(userId, true);
    rows = db.prepare("SELECT * FROM shop_items WHERE user_id=?").all(userId) as typeof rows;
  }
  const items = rows.map((r) => {
    const inst = db.prepare("SELECT * FROM item_instances WHERE id=?").get(r.instance_id) as InstanceRow;
    return { ...r, item: publicItem(inst) };
  });
  return { slots, level: user.shop_level, items, refreshCost: CONFIG.SHOP_REFRESH_COST, upgradeCost: CONFIG.SHOP_UPGRADE_BASE * user.shop_level };
}

export function refreshShop(userId: string, free = false) {
  return tx(() => {
    if (!free && !spendCoins(userId, CONFIG.SHOP_REFRESH_COST, "SHOP_REFRESH", "shop")) return { error: "Not enough coins." };
    const old = db.prepare("SELECT instance_id FROM shop_items WHERE user_id=?").all(userId) as { instance_id: string }[];
    for (const o of old) destroyInstance(o.instance_id);
    db.prepare("DELETE FROM shop_items WHERE user_id=?").run(userId);
    const user = db.prepare("SELECT shop_level, highest_region FROM users WHERE id=?").get(userId) as {
      shop_level: number;
      highest_region: number;
    };
    const slots = Math.min(CONFIG.SHOP_MAX_ITEMS, CONFIG.SHOP_START_ITEMS + user.shop_level - 1);
    const defs = db.prepare("SELECT id FROM item_definitions WHERE slot IS NOT NULL AND slot != ''").all() as { id: string }[];
    for (let i = 0; i < slots; i++) {
      const def = defs[Math.floor(Math.random() * defs.length)]!;
      const inst = generateInstance({
        definitionId: def.id,
        ownerUserId: userId,
        location: "SHOP",
        region: Math.max(1, user.highest_region || 1),
      });
      const price = Math.round(itemValue(inst) * 2.4);
      db.prepare("INSERT INTO shop_items (id,user_id,instance_id,price,slot,generated_at) VALUES (?,?,?,?,?,?)").run(
        uuid(),
        userId,
        inst.id,
        price,
        i,
        now()
      );
    }
    return { error: null };
  });
}

export function buyShop(userId: string, shopItemId: string) {
  return tx(() => {
    const { error, character } = requireAlive(userId);
    if (error || !character) return { error };
    if (character.location !== "CITY") return { error: "The stall is in the city." };
    const row = db.prepare("SELECT * FROM shop_items WHERE id=? AND user_id=?").get(shopItemId, userId) as
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
      "UPDATE item_instances SET location='INVENTORY', owner_character_id=?, grid_x=?, grid_y=?, rotated=? WHERE id=?"
    ).run(character.id, spot.x, spot.y, spot.rotated, inst.id);
    db.prepare("DELETE FROM shop_items WHERE instance_id=?").run(inst.id);
    return { error: null };
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
    const price = itemValue(inst);
    destroyInstance(inst.id);
    addCoins(userId, price, "ITEM_SELL", "shop", { instance: instanceId });
    return { error: null, price };
  });
}

export function upgradeShop(userId: string) {
  const user = db.prepare("SELECT shop_level FROM users WHERE id=?").get(userId) as { shop_level: number };
  if (CONFIG.SHOP_START_ITEMS + user.shop_level - 1 >= CONFIG.SHOP_MAX_ITEMS) return { error: "The stall is as wide as it will go." };
  const cost = CONFIG.SHOP_UPGRADE_BASE * user.shop_level;
  if (!spendCoins(userId, cost, "UPGRADE", "shop-level")) return { error: "Not enough coins." };
  db.prepare("UPDATE users SET shop_level = shop_level + 1 WHERE id=?").run(userId);
  refreshShop(userId, true);
  return { error: null };
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
    if (!spendCoins(userId, cost, "FORGE", "forge", { keep: items[0]!.id, rarity, next })) {
      return { error: "Not enough coins." };
    }
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

export function adminGate() {
  return loadGate();
}

export function adminSaveGate(raw: unknown) {
  const gate = saveGate(raw);
  logGame("ADMIN", `gate ${gate.version}${gate.maintenance ? " closed" : " open"}`);
  return gate;
}

export { storageCapacity, storageGridSize, loadStorage, characterPower };
