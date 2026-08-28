import { db } from "../db.ts";
import { CLASS_BASE, addStats, emptyStats, type Stats, type StatKey, STAT_KEYS } from "./stats.ts";
import type { InstanceRow } from "./items.ts";
import { loadEquip } from "./inventory.ts";

export type Combatant = {
  name: string;
  hp: number;
  maxHp: number;
  stats: Record<StatKey, number>;
  undead?: boolean;
};

export function characterPower(character: {
  id: string;
  class: string;
  level: number;
}) {
  const base = CLASS_BASE[character.class as keyof typeof CLASS_BASE];
  let stats = emptyStats();
  stats.health = base.health + (character.level - 1) * 12;
  stats.damage = base.damage + (character.level - 1) * 2;
  stats.armor = base.armor + Math.floor((character.level - 1) * 0.6);
  stats.critChance = base.critChance;
  stats.critDamage = base.critDamage;
  stats.attackSpeed = Math.round((base.attackSpeed - 1) * 1000) / 10;
  stats.dodge = base.dodge;
  stats.lifesteal = base.lifesteal;
  for (const [k, v] of Object.entries(base.pass)) {
    if (k === "healthPct") stats.health = Math.round(stats.health * (1 + v / 100));
    else if (k in stats) stats[k as StatKey] += v;
  }
  const gear = loadEquip(character.id);
  const setCount = new Map<string, number>();
  for (const g of gear) {
    const st = JSON.parse(g.stats) as Stats;
    stats = addStats(stats, st);
    const def = db.prepare("SELECT set_id FROM item_definitions WHERE id = ?").get(g.definition_id) as { set_id: string | null };
    if (def?.set_id) setCount.set(def.set_id, (setCount.get(def.set_id) || 0) + 1);
  }
  const setBonuses: { set: string; pieces: number; bonus: Stats }[] = [];
  for (const [sid, n] of setCount) {
    const s = db.prepare("SELECT * FROM item_sets WHERE id = ?").get(sid) as {
      name: string;
      bonus_2: string;
      bonus_3: string;
      bonus_4: string;
      bonus_5: string;
    };
    if (!s) continue;
    let bonus: Stats = {};
    if (n >= 2) bonus = JSON.parse(s.bonus_2);
    if (n >= 3) bonus = JSON.parse(s.bonus_3);
    if (n >= 4) bonus = JSON.parse(s.bonus_4);
    if (n >= 5) bonus = JSON.parse(s.bonus_5);
    stats = addStats(stats, bonus);
    setBonuses.push({ set: s.name, pieces: n, bonus });
  }
  const skills = db
    .prepare(
      `SELECT s.stats FROM character_skills cs JOIN skills s ON s.id = cs.skill_id WHERE cs.character_id = ?`
    )
    .all(character.id) as { stats: string }[];
  for (const sk of skills) stats = addStats(stats, JSON.parse(sk.stats));
  const maxHp = Math.max(20, Math.round(stats.health));
  return { stats, maxHp, setBonuses, gear };
}

type LogLine = { t: number; text: string };

export function simulateCombat(player: Combatant, enemy: Combatant) {
  const log: LogLine[] = [];
  let tick = 0;
  let pCd = 0;
  let eCd = 0;
  const pDots: { kind: string; dmg: number; left: number }[] = [];
  const eDots: { kind: string; dmg: number; left: number }[] = [];
  const pAtkInterval = Math.max(8, Math.round(20 / (1 + player.stats.attackSpeed / 100)));
  const eAtkInterval = Math.max(8, Math.round(20 / Math.max(0.4, enemy.stats.attackSpeed / 100 || 1)));

  function hit(att: Combatant, def: Combatant, who: "PLAYER" | "ENEMY") {
    if (Math.random() * 100 < def.stats.dodge) {
      log.push({ t: tick, text: `${def.name} DODGES` });
      return;
    }
    let dmg = att.stats.damage;
    const crit = Math.random() * 100 < att.stats.critChance;
    if (crit) {
      dmg *= att.stats.critDamage / 100 || 1.5;
      log.push({ t: tick, text: `CRITICAL HIT!` });
    }
    if (def.undead) dmg *= 1 + (att.stats.undeadDamage || 0) / 100;
    if (def.hp / def.maxHp < 0.3) dmg *= 1 + (att.stats.execute || 0) / 100;
    const pen = Math.min(0.8, (att.stats.armorPen || 0) / 100);
    const armorEff = def.stats.armor * (1 - pen);
    const reduced = dmg * (100 / (100 + Math.max(0, armorEff)));
    const dealt = Math.max(1, Math.round(reduced));
    def.hp -= dealt;
    log.push({ t: tick, text: `${att.name} strikes ${def.name} for ${dealt}` });
    if (armorEff > 8) log.push({ t: tick, text: `ARMOR BLOCKS some of the blow` });
    const ls = Math.round(dealt * (att.stats.lifesteal || 0) / 100);
    if (ls > 0) {
      att.hp = Math.min(att.maxHp, att.hp + ls);
      log.push({ t: tick, text: `${att.name} leeches ${ls}` });
    }
    const targetDots = who === "PLAYER" ? eDots : pDots;
    if (att.stats.bleed > 0 && Math.random() < 0.45) {
      targetDots.push({ kind: "BLEED", dmg: Math.round(att.stats.bleed), left: 5 });
      log.push({ t: tick, text: `BLEED applied to ${def.name}` });
    }
    if (att.stats.poison > 0 && Math.random() < 0.4) {
      targetDots.push({ kind: "POISON", dmg: Math.round(att.stats.poison), left: 6 });
      log.push({ t: tick, text: `POISON applied to ${def.name}` });
    }
    if (att.stats.fire > 0 && Math.random() < 0.4) {
      targetDots.push({ kind: "FIRE", dmg: Math.round(att.stats.fire), left: 4 });
      log.push({ t: tick, text: `FIRE applied to ${def.name}` });
    }
  }

  log.push({ t: 0, text: `${player.name} faces ${enemy.name}` });
  while (player.hp > 0 && enemy.hp > 0 && tick < 1800) {
    tick++;
    pCd++;
    eCd++;
    if (tick % 8 === 0) {
      player.hp = Math.min(player.maxHp, player.hp + (player.stats.regen || 0));
      enemy.hp = Math.min(enemy.maxHp, enemy.hp + (enemy.stats.regen || 0));
    }
    if (tick % 4 === 0) {
      for (const d of eDots) {
        if (d.left > 0) {
          enemy.hp -= d.dmg;
          d.left--;
          log.push({ t: tick, text: `${enemy.name} suffers ${d.dmg} ${d.kind}` });
        }
      }
      for (const d of pDots) {
        if (d.left > 0) {
          player.hp -= d.dmg;
          d.left--;
          log.push({ t: tick, text: `${player.name} suffers ${d.dmg} ${d.kind}` });
        }
      }
    }
    if (pCd >= pAtkInterval) {
      pCd = 0;
      hit(player, enemy, "PLAYER");
    }
    if (player.hp <= 0 || enemy.hp <= 0) break;
    if (eCd >= eAtkInterval) {
      eCd = 0;
      hit(enemy, player, "ENEMY");
    }
  }
  const won = enemy.hp <= 0 && player.hp > 0;
  if (won) log.push({ t: tick, text: `${enemy.name} FALLS` });
  else log.push({ t: tick, text: `${player.name} HAS FALLEN` });
  return {
    won,
    log,
    ticks: tick,
    playerHp: Math.max(0, Math.round(player.hp)),
    enemyHp: Math.max(0, Math.round(enemy.hp)),
  };
}
