import bcrypt from "bcryptjs";
import { db, now } from "../db.ts";
import { CONFIG } from "../config.ts";
import { SETS, ITEM_DEFS, SKILLS, REGIONS, ENEMIES } from "./content.ts";

export function seedIfEmpty() {
  const n = db.prepare("SELECT COUNT(*) AS c FROM item_definitions").get() as { c: number };
  if (n.c > 0) return;

  const insSet = db.prepare(
    "INSERT INTO item_sets (id, name, flavor, bonus_2, bonus_3, bonus_4, bonus_5) VALUES (@id,@name,@flavor,@bonus_2,@bonus_3,@bonus_4,@bonus_5)"
  );
  for (const s of SETS) insSet.run(s);

  const insDef = db.prepare(
    `INSERT INTO item_definitions (id,name,category,slot,rarity_min,base_level,required_level,width,height,stackable,max_stack,base_stats,affix_pool,set_id,glyph,flavor,tags,sell_mult)
     VALUES (@id,@name,@category,@slot,@rarity_min,@base_level,@required_level,@width,@height,@stackable,@max_stack,@base_stats,@affix_pool,@set_id,@glyph,@flavor,@tags,@sell_mult)`
  );
  for (const d of ITEM_DEFS) {
    insDef.run({
      ...d,
      slot: d.slot,
      base_stats: JSON.stringify(d.base_stats),
      affix_pool: JSON.stringify(d.affix_pool),
      tags: JSON.stringify(d.tags),
    });
  }

  const insSk = db.prepare("INSERT INTO skills (id, name, description, stats) VALUES (?, ?, ?, ?)");
  for (const s of SKILLS) insSk.run(s.id, s.name, s.description, JSON.stringify(s.stats));

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

if (process.argv[1]?.includes("seed/run")) seedIfEmpty();
