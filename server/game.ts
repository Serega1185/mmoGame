import { v4 as uuid } from "uuid";
import { db, now, tx } from "./db.ts";
import { CONFIG } from "./config.ts";
import { CLASS_BASE, emptyStats, type Stats } from "./engine/stats.ts";
import { generateInstance, hydrate, destroyInstance, itemValue, type InstanceRow } from "./engine/items.ts";
import {
  buildGrid,
  canPlace,
  findPlace,
  loadInv,
  loadEquip,
  loadStorage,
  storageCapacity,
  storageGridSize,
} from "./engine/inventory.ts";
import { characterPower, simulateCombat } from "./engine/combat.ts";
import { rollLoot, clearGround } from "./engine/loot.ts";
import { addCoins, spendCoins, logGame } from "./engine/economy.ts";

export function publicItem(inst: InstanceRow) {
  return hydrate(inst);
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

export function snapshotCharacter(c: Record<string, unknown>) {
  const power = characterPower({ id: String(c.id), class: String(c.class), level: Number(c.level) });
  const inv = loadInv(String(c.id)).map(publicItem);
  const eq = loadEquip(String(c.id)).map(publicItem);
  const ground = (
    db
      .prepare(
        `SELECT i.* FROM ground_loot g JOIN item_instances i ON i.id = g.instance_id WHERE g.character_id = ? AND i.location = 'GROUND'`
      )
      .all(c.id) as InstanceRow[]
  ).map(publicItem);
  const skills = db
    .prepare(
      `SELECT s.* FROM character_skills cs JOIN skills s ON s.id = cs.skill_id WHERE cs.character_id = ? ORDER BY cs.picked_at`
    )
    .all(c.id);
  const region = db.prepare("SELECT * FROM regions WHERE id = ?").get(c.region);
  const pending = Number(c.skill_pending)
    ? (() => {
        const ids = JSON.parse(String(c.skill_offers || "[]")) as string[];
        if (!ids.length) return db.prepare("SELECT * FROM skills ORDER BY RANDOM() LIMIT 3").all() as unknown[];
        return ids
          .map((id) => db.prepare("SELECT * FROM skills WHERE id=?").get(id))
          .filter(Boolean);
      })()
    : [];
  return {
    character: { ...c, power },
    inventory: inv,
    equipment: eq,
    ground,
    skills,
    skillChoices: pending,
    region,
    grid: { cols: CONFIG.GRID_COLS, rows: CONFIG.GRID_ROWS },
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
  db.prepare(
    `INSERT INTO characters (id,user_id,name,class,level,xp,region,round,hp,max_hp,status,location,created_at)
     VALUES (?,?,?,?,1,0,1,1,?,?, 'ALIVE','WILD',?)`
  ).run(id, userId, name.trim(), cls, hp, hp, now());
  const starters: Record<string, string[]> = {
    Ironclad: ["peat_shortsword", "wood_buckler", "padded_jack", "iron_cap"],
    Shadehand: ["ash_knife", "wool_hood", "hide_jerkin", "clogs"],
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
      const { w, h } = { w: spot.rotated ? it.height : it.width, h: spot.rotated ? it.width : it.height };
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) grid[spot.y + y]![spot.x + x] = it.id;
    }
  }
  return { error: null, id };
}

function pickEnemy(regionId: number, round: number) {
  const region = db.prepare("SELECT * FROM regions WHERE id = ?").get(regionId) as {
    enemy_pool: string;
    elite_pool: string;
    boss_id: string;
  };
  if (round >= CONFIG.ROUNDS_PER_REGION) {
    return db.prepare("SELECT * FROM enemies WHERE id = ?").get(region.boss_id);
  }
  if (round === 5 || Math.random() < 0.12) {
    const elites = JSON.parse(region.elite_pool) as string[];
    const id = elites[Math.floor(Math.random() * elites.length)];
    return db.prepare("SELECT * FROM enemies WHERE id = ?").get(id);
  }
  const pool = JSON.parse(region.enemy_pool) as string[];
  const id = pool[Math.floor(Math.random() * pool.length)];
  return db.prepare("SELECT * FROM enemies WHERE id = ?").get(id);
}

export function startCombat(userId: string) {
  return tx(() => {
    const { error, character } = requireAlive(userId);
    if (error || !character) return { error: error || "No character" };
    if (character.location === "CITY") return { error: "The city is safe. Take the road if you want blood." };
    clearGround(String(character.id));
    const enemy = pickEnemy(Number(character.region), Number(character.round)) as {
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
    const power = characterPower({
      id: String(character.id),
      class: String(character.class),
      level: Number(character.level),
    });
    const lootTable = JSON.parse(enemy.loot_table || "{}") as { undead?: boolean };
    const player = {
      name: String(character.name),
      hp: Number(character.hp),
      maxHp: power.maxHp,
      stats: power.stats,
    };
    const foe = {
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
        attackSpeed: (enemy.attack_speed - 1) * 100,
        dodge: enemy.dodge * 100,
        regen: JSON.parse(enemy.abilities).includes("regen") ? 2 : 0,
        bleed: JSON.parse(enemy.abilities).includes("bleed") ? 4 : 0,
        poison: JSON.parse(enemy.abilities).includes("poison") ? 4 : 0,
        fire: JSON.parse(enemy.abilities).includes("fire") ? 4 : 0,
      },
    };
    const result = simulateCombat(player, foe);
    if (result.won) {
      const loot = rollLoot({
        userId,
        characterId: String(character.id),
        region: Number(character.region),
        enemyKind: enemy.kind,
        lootChance: power.stats.lootChance,
        goldFind: power.stats.goldFind,
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
      db.prepare(
        `UPDATE characters SET hp=?, max_hp=?, level=?, xp=?, enemies_defeated = enemies_defeated + 1, gold_earned = gold_earned + ? WHERE id=?`
      ).run(Math.min(newMax, result.playerHp + Math.round(newMax * 0.15)), newMax, level, xp, loot.gold, character.id);
      let bestName = String(character.best_item_name || "");
      let bestR = String(character.best_item_rarity || "Common");
      const rank = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"];
      let lootVal = Number(character.loot_value || 0);
      for (const it of loot.items) {
        lootVal += itemValue(it);
        const def = db.prepare("SELECT name FROM item_definitions WHERE id = ?").get(it.definition_id) as { name: string };
        if (rank.indexOf(it.rarity) >= rank.indexOf(bestR)) {
          bestR = it.rarity;
          bestName = def.name;
        }
      }
      db.prepare("UPDATE characters SET best_item_name=?, best_item_rarity=?, loot_value=? WHERE id=?").run(
        bestName || null,
        bestR,
        lootVal,
        character.id
      );
      const offerSkill =
        Number(character.round) % CONFIG.SKILL_EVERY_ROUNDS === 0 && Number(character.round) < CONFIG.ROUNDS_PER_REGION;
      if (offerSkill) {
        const offers = db.prepare("SELECT id FROM skills ORDER BY RANDOM() LIMIT 3").all() as { id: string }[];
        db.prepare("UPDATE characters SET skill_pending = 1, skill_offers = ? WHERE id = ?").run(
          JSON.stringify(offers.map((o) => o.id)),
          character.id
        );
      }
      return {
        error: null,
        result: {
          won: true,
          enemy,
          ...result,
          gold: loot.gold,
          loot: loot.items.map(publicItem),
          xpGain,
          level,
        },
      };
    }
    return finishDeath(userId, character, enemy, result);
  });
}

function finishDeath(userId: string, character: Record<string, unknown>, enemy: { name: string }, result: { log: unknown; ticks: number; playerHp: number }) {
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

export function pickSkill(userId: string, skillId: string) {
  const { error, character } = requireAlive(userId);
  if (error || !character) return { error };
  if (!character.skill_pending) return { error: "No omen to choose." };
  const skill = db.prepare("SELECT * FROM skills WHERE id = ?").get(skillId);
  if (!skill) return { error: "Unknown omen." };
  db.prepare("INSERT INTO character_skills (character_id, skill_id, picked_at) VALUES (?, ?, ?)").run(character.id, skillId, now());
  db.prepare("UPDATE characters SET skill_pending = 0, skill_offers = NULL WHERE id = ?").run(character.id);
  return { error: null };
}

export function advanceAfterLoot(userId: string) {
  return tx(() => {
    const { error, character } = requireAlive(userId);
    if (error || !character) return { error };
    if (character.skill_pending) return { error: "Choose an omen before you walk on." };
    const leftover = db.prepare("SELECT COUNT(*) AS c FROM ground_loot g JOIN item_instances i ON i.id = g.instance_id WHERE g.character_id=? AND i.location='GROUND'").get(character.id) as { c: number };
    if (leftover.c > 0) {
      clearGround(String(character.id));
    }
    const round = Number(character.round);
    const region = Number(character.region);
    if (round >= CONFIG.ROUNDS_PER_REGION) {
      db.prepare("UPDATE characters SET location='CITY' WHERE id=?").run(character.id);
      const u = db.prepare("SELECT highest_region FROM users WHERE id=?").get(userId) as { highest_region: number };
      if (region > u.highest_region) db.prepare("UPDATE users SET highest_region=? WHERE id=?").run(region, userId);
      return { error: null, city: true, region };
    }
    db.prepare("UPDATE characters SET round = round + 1 WHERE id=?").run(character.id);
    return { error: null, city: false, round: round + 1 };
  });
}

export function leaveCity(userId: string) {
  const { error, character } = requireAlive(userId);
  if (error || !character) return { error };
  if (character.location !== "CITY") return { error: "You are already on the road." };
  const nextRegion = Number(character.region) + 1;
  const exists = db.prepare("SELECT id FROM regions WHERE id=?").get(nextRegion);
  if (!exists) return { error: "No further marches are charted. The cinder road ends here — for now." };
  db.prepare("UPDATE characters SET region=?, round=1, location='WILD', hp=max_hp WHERE id=?").run(nextRegion, character.id);
  return { error: null, region: nextRegion };
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
      if (x == null || y == null) {
        const spot = findPlace(grid, probe);
        if (!spot) return { error: "No space in the pack." };
        x = spot.x;
        y = spot.y;
        probe.rotated = spot.rotated;
      } else if (!canPlace(grid, probe, x, y)) return { error: "That cell is blocked." };
      if (inst.location === "STORAGE" && character.location !== "CITY") return { error: "The vault opens only within the city walls." };
      if (inst.location === "GROUND") db.prepare("DELETE FROM ground_loot WHERE instance_id=?").run(inst.id);
      db.prepare(
        "UPDATE item_instances SET location='INVENTORY', owner_character_id=?, grid_x=?, grid_y=?, rotated=?, equip_slot=NULL WHERE id=?"
      ).run(character.id, x, y, probe.rotated, inst.id);
      return { error: null };
    }

    if (opts.dest === "STORAGE") {
      const user = db.prepare("SELECT storage_level FROM users WHERE id=?").get(userId) as { storage_level: number };
      const { cols, rows, cells } = storageGridSize(user.storage_level);
      const items = loadStorage(userId).filter((i) => i.id !== inst.id);
      if (items.reduce((n, it) => n + it.width * it.height, 0) + inst.width * inst.height > cells) {
        return { error: "The chest is full. Pay the carpenter to enlarge it." };
      }
      const grid = buildGrid(items, cols, rows);
      const rotated = opts.rotated ?? inst.rotated;
      const probe = { ...inst, rotated };
      let x = opts.x;
      let y = opts.y;
      if (x == null || y == null) {
        const spot = findPlace(grid, probe);
        if (!spot) return { error: "No space in the chest." };
        x = spot.x;
        y = spot.y;
        probe.rotated = spot.rotated;
      } else if (!canPlace(grid, probe, x, y)) return { error: "That cell is blocked." };
      db.prepare(
        "UPDATE item_instances SET location='STORAGE', owner_character_id=NULL, grid_x=?, grid_y=?, rotated=?, equip_slot=NULL WHERE id=?"
      ).run(x, y, probe.rotated, inst.id);
      return { error: null };
    }

    if (opts.dest === "EQUIPMENT") {
      const slot = opts.slot;
      if (!slot) return { error: "Which harness?" };
      const def = db.prepare("SELECT slot FROM item_definitions WHERE id=?").get(inst.definition_id) as { slot: string | null };
      if (!def?.slot) return { error: "That cannot be worn." };
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
      const power = characterPower({ id: String(character.id), class: String(character.class), level: Number(character.level) });
      db.prepare("UPDATE characters SET max_hp=?, hp=MIN(hp, ?) WHERE id=?").run(power.maxHp, power.maxHp, character.id);
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
    if (!free && !spendCoins(userId, CONFIG.SHOP_REFRESH_COST, "SHOP_REFRESH", "shop")) return { error: "Not enough crowns." };
    const old = db.prepare("SELECT instance_id FROM shop_items WHERE user_id=?").all(userId) as { instance_id: string }[];
    for (const o of old) destroyInstance(o.instance_id);
    db.prepare("DELETE FROM shop_items WHERE user_id=?").run(userId);
    const user = db.prepare("SELECT shop_level, highest_region FROM users WHERE id=?").get(userId) as {
      shop_level: number;
      highest_region: number;
    };
    const slots = Math.min(CONFIG.SHOP_MAX_ITEMS, CONFIG.SHOP_START_ITEMS + user.shop_level - 1);
    const defs = db.prepare("SELECT id FROM item_definitions").all() as { id: string }[];
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
    if (!spendCoins(userId, row.price, "SHOP_BUY", "shop", { instance: row.instance_id })) return { error: "Not enough crowns." };
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
  if (!spendCoins(userId, cost, "UPGRADE", "shop-level")) return { error: "Not enough crowns." };
  db.prepare("UPDATE users SET shop_level = shop_level + 1 WHERE id=?").run(userId);
  refreshShop(userId, true);
  return { error: null };
}

export function upgradeStorage(userId: string) {
  const user = db.prepare("SELECT storage_level FROM users WHERE id=?").get(userId) as { storage_level: number };
  if (user.storage_level >= CONFIG.STORAGE_MAX_LEVEL) return { error: "The vault cannot swell further." };
  const cost = CONFIG.STORAGE_UPGRADE_BASE * user.storage_level * user.storage_level;
  if (!spendCoins(userId, cost, "UPGRADE", "storage-level")) return { error: "Not enough crowns." };
  db.prepare("UPDATE users SET storage_level = storage_level + 1 WHERE id=?").run(userId);
  return { error: null };
}

export function upgradeAuction(userId: string) {
  const user = db.prepare("SELECT auction_level FROM users WHERE id=?").get(userId) as { auction_level: number };
  const slots = CONFIG.AUCTION_START_LISTINGS + user.auction_level - 1;
  if (slots >= CONFIG.AUCTION_MAX_LISTINGS) return { error: "The board holds all it can." };
  const cost = 600 * user.auction_level;
  if (!spendCoins(userId, cost, "UPGRADE", "auction-level")) return { error: "Not enough crowns." };
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
      return { error: `The crier demands ${fee} crowns in fee.` };
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
      return { error: "Not enough crowns." };
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
      return { error: `Founding costs ${CONFIG.GUILD_CREATION_COST} crowns.` };
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
    if (!spendCoins(userId, cost, "UPGRADE", "guild-level")) return { error: "Not enough crowns." };
    db.prepare("UPDATE guilds SET level = level + 1 WHERE id=?").run(g.id);
    return { error: null };
  });
}

export { storageCapacity, storageGridSize, loadStorage, characterPower };
