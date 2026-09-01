import bcrypt from "bcryptjs";
import { db, now } from "../db.ts";
import { CONFIG } from "../config.ts";
import { SETS, ITEM_DEFS, SKILLS, REGIONS, ENEMIES } from "./content.ts";
import { rerollInstanceFromDefinition, type InstanceRow } from "../engine/items.ts";
import { seedItemI18n } from "../engine/itemCatalog.ts";
import { seedEnemyI18n } from "../engine/enemyCatalog.ts";
import { seedHeroes } from "../engine/heroTables.ts";
import { seedTalents } from "../engine/talents.ts";

function upsertCatalog() {
  const upSet = db.prepare(
    `INSERT INTO item_sets (id, name, flavor, bonus_2, bonus_3, bonus_4, bonus_5)
     VALUES (@id,@name,@flavor,@bonus_2,@bonus_3,@bonus_4,@bonus_5)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, flavor=excluded.flavor,
       bonus_2=excluded.bonus_2, bonus_3=excluded.bonus_3, bonus_4=excluded.bonus_4, bonus_5=excluded.bonus_5`
  );
  for (const s of SETS) upSet.run(s);

  const upDef = db.prepare(
    `INSERT INTO item_definitions (id,name,category,slot,rarity_min,base_level,required_level,width,height,stackable,max_stack,base_stats,affix_pool,set_id,glyph,flavor,tags,sell_mult)
     VALUES (@id,@name,@category,@slot,@rarity_min,@base_level,@required_level,@width,@height,@stackable,@max_stack,@base_stats,@affix_pool,@set_id,@glyph,@flavor,@tags,@sell_mult)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, category=excluded.category, slot=excluded.slot, rarity_min=excluded.rarity_min,
       base_level=excluded.base_level, required_level=excluded.required_level, width=1, height=1,
       stackable=excluded.stackable, max_stack=excluded.max_stack, base_stats=excluded.base_stats,
       affix_pool=excluded.affix_pool, set_id=excluded.set_id, glyph=excluded.glyph, flavor=excluded.flavor,
       tags=excluded.tags, sell_mult=excluded.sell_mult`
  );
  for (const d of ITEM_DEFS) {
    upDef.run({
      ...d,
      width: 1,
      height: 1,
      slot: d.slot,
      base_stats: JSON.stringify(d.base_stats),
      affix_pool: JSON.stringify(d.affix_pool),
      tags: JSON.stringify(d.tags),
    });
  }

  const upSk = db.prepare(
    `INSERT INTO skills (id, name, description, stats) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, stats=excluded.stats`
  );
  for (const s of SKILLS) upSk.run(s.id, s.name, s.description, JSON.stringify(s.stats));
}

function purgeRemovedDefs() {
  const keep = new Set(ITEM_DEFS.map((d) => d.id));
  const rows = db.prepare("SELECT id FROM item_definitions").all() as { id: string }[];
  for (const row of rows) {
    if (keep.has(row.id) || row.id.startsWith("custom_")) continue;
    const inst = db.prepare("SELECT id FROM item_instances WHERE definition_id = ?").all(row.id) as { id: string }[];
    for (const it of inst) {
      db.prepare("DELETE FROM shop_items WHERE instance_id = ?").run(it.id);
      db.prepare("DELETE FROM ground_loot WHERE instance_id = ?").run(it.id);
      db.prepare("DELETE FROM auction_listings WHERE instance_id = ?").run(it.id);
      db.prepare("DELETE FROM item_links WHERE instance_id = ?").run(it.id);
      db.prepare("DELETE FROM item_instances WHERE id=?").run(it.id);
    }
    db.prepare("DELETE FROM item_i18n WHERE definition_id=?").run(row.id);
    db.prepare("DELETE FROM item_definitions WHERE id=?").run(row.id);
  }
}

export function refreshCatalog() {
  upsertCatalog();
  purgeRemovedDefs();
  db.prepare(
    `UPDATE item_instances SET location='INVENTORY', equip_slot=NULL, grid_x=NULL, grid_y=NULL
     WHERE equip_slot = 'Accessory'`
  ).run();
  const rows = db.prepare("SELECT * FROM item_instances WHERE location != 'DESTROYED'").all() as InstanceRow[];
  for (const row of rows) rerollInstanceFromDefinition(row);
  seedItemI18n();
  seedEnemyI18n();
  seedHeroes();
  seedTalents();
}

export function seedIfEmpty() {
  const n = db.prepare("SELECT COUNT(*) AS c FROM item_definitions").get() as { c: number };
  upsertCatalog();
  purgeRemovedDefs();
  if (n.c === 0) {

    const insR = db.prepare(
      "INSERT INTO regions (id, slug, name, theme, description, min_level, enemy_pool, elite_pool, boss_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    for (const r of REGIONS) {
      const normals = ENEMIES.filter((e) => e.region === r.id && e.kind === "normal").map((e) => e.id);
      const elites = ENEMIES.filter((e) => e.region === r.id && e.kind === "elite").map((e) => e.id);
      const boss = ENEMIES.find((e) => e.region === r.id && e.kind === "boss")!;
      insR.run(r.id, r.slug, r.name, r.theme, r.description, r.min_level, JSON.stringify(normals), JSON.stringify(elites), boss.id);
    }

    const insE = db.prepare(
      `INSERT INTO enemies (id,name,kind,hp,damage,armor,crit_chance,attack_speed,dodge,abilities,loot_table,region,glyph)
       VALUES (@id,@name,@kind,@hp,@damage,@armor,@crit_chance,@attack_speed,@dodge,@abilities,@loot_table,@region,@glyph)`
    );
    for (const e of ENEMIES) {
      insE.run({
        ...e,
        abilities: JSON.stringify(e.abilities),
        loot_table: JSON.stringify({ undead: !!e.undead }),
      });
    }

    const adminHash = bcrypt.hashSync("Ashmarch#Seneschal", 10);
    const demoHash = bcrypt.hashSync("Wayfarer#1", 10);
    const t = now();
    db.prepare(
      `INSERT INTO users (id,email,username,password_hash,role,coins,storage_level,shop_level,auction_level,highest_region,created_at,last_seen)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run("user_admin", CONFIG.ADMIN_EMAIL, "Seneschal", adminHash, "admin", 750000, 3, 3, 4, 30, t, t);
    db.prepare(
      `INSERT INTO users (id,email,username,password_hash,role,coins,storage_level,shop_level,auction_level,highest_region,created_at,last_seen)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run("user_demo", "wayfarer@ashmarch.local", "Wayfarer", demoHash, "player", 400, 1, 1, 1, 0, t, t);

    console.log(`Seeded ${ITEM_DEFS.length} items, ${SETS.length} sets, ${ENEMIES.length} enemies, ${REGIONS.length} regions.`);
  }
  refreshCatalog();
}

if (process.argv[1]?.includes("seed/run")) seedIfEmpty();
