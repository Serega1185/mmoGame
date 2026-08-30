import { db } from "../db.ts";
import {
  CLASS_BASE,
  addStats,
  emptyStats,
  exclusiveDamage,
  pickStatsForRarity,
  sanitizeStats,
  schoolFromTags,
  type MagicSchool,
  type Rarity,
  type Stats,
  type StatKey,
} from "./stats.ts";
import { loadHeroBase } from "./heroTables.ts";
import { loadEquip } from "./inventory.ts";
import { isTalentId } from "./talents.ts";

export type Combatant = {
  id?: string;
  name: string;
  hp: number;
  maxHp: number;
  stats: Record<StatKey, number>;
  isMagic?: boolean;
  magicSchool?: MagicSchool | null;
  talents?: string[];
  heavyPct?: number;
  burnOnHit?: { chance: number; hits: number; dmg: number };
};

type Unit = Combatant & {
  armorPool: number;
  barrier: number;
  thorns: number;
  poison: number;
  bleed: number;
  burnHits: number;
  burnDmg: number;
  frozen: boolean;
  isMagic: boolean;
  magicSchool: MagicSchool | null;
  talents: Set<string>;
  ironWillUsed: boolean;
};

export function characterPower(character: { id: string; class: string; level: number }) {
  const hero = loadHeroBase(character.class);
  const fb = CLASS_BASE.Ironclad;
  const health = hero?.health ?? fb.health;
  const damage = hero?.damage ?? fb.damage;
  const armor = hero?.armor ?? fb.armor;
  const critChance = hero?.critChance ?? fb.critChance;
  const critDamage = hero?.critDamage ?? fb.critDamage;
  const dodge = hero?.dodge ?? fb.dodge;
  const lifesteal = hero?.lifesteal ?? fb.lifesteal;
  const luck = hero?.luck ?? 0;
  const magicDamage = hero?.magicDamage ?? 0;
  const pass = hero?.pass ?? { ...fb.pass };
  let stats = emptyStats();
  const lv = Math.max(0, character.level - 1);
  stats.health = health + lv * 12;
  stats.damage = damage + lv * 2;
  stats.armor = armor + Math.floor(lv * 0.6);
  stats.critChance = critChance;
  stats.critDamage = critDamage;
  stats.dodge = dodge;
  stats.lifesteal = lifesteal;
  stats.luck = luck;
  stats.magicDamage = magicDamage + (magicDamage > 0 ? lv * 2 : 0);
  for (const [k, v] of Object.entries(pass)) {
    if (k === "healthPct") stats.health = Math.round(stats.health * (1 + v / 100));
    else if (k in stats) stats[k as StatKey] += v;
  }
  const gear = loadEquip(character.id);
  const setCount = new Map<string, number>();
  let isMagic = false;
  let magicSchool: MagicSchool | null = null;
  for (const g of gear) {
    const st = JSON.parse(g.stats) as Stats;
    const def = db.prepare("SELECT set_id, tags FROM item_definitions WHERE id = ?").get(g.definition_id) as {
      set_id: string | null;
      tags: string;
    };
    const tags = JSON.parse(def?.tags || "[]") as string[];
    const magic = tags.includes("magic");
    stats = addStats(
      stats,
      pickStatsForRarity(exclusiveDamage(sanitizeStats(st as Record<string, number>), magic), g.rarity as Rarity)
    );
    if (g.equip_slot === "Weapon") {
      const school = schoolFromTags(tags);
      if (school) {
        isMagic = true;
        magicSchool = school;
      }
    }
    if (def?.set_id) setCount.set(def.set_id, (setCount.get(def.set_id) || 0) + 1);
  }
  const setBonuses: {
    set: string;
    setId: string;
    pieces: number;
    size: number;
    bonus: Stats;
    tiers: { pieces: number; bonus: Stats }[];
  }[] = [];
  const catalog = db.prepare("SELECT * FROM item_sets").all() as {
    id: string;
    name: string;
    bonus_2: string;
    bonus_3: string;
    bonus_4: string;
    bonus_5: string;
  }[];
  for (const s of catalog) {
    const n = setCount.get(s.id) || 0;
    let bonus: Stats = {};
    const tiers: { pieces: number; bonus: Stats }[] = [];
    let prevSig = "";
    for (const need of [2, 3, 4, 5] as const) {
      const next = JSON.parse(
        need === 2 ? s.bonus_2 : need === 3 ? s.bonus_3 : need === 4 ? s.bonus_4 : s.bonus_5
      ) as Stats;
      const sig = JSON.stringify(next);
      if (!Object.values(next).some((v) => v) || sig === prevSig) continue;
      tiers.push({ pieces: need, bonus: next });
      prevSig = sig;
      if (n >= need) bonus = next;
    }
    stats = addStats(stats, sanitizeStats(bonus as Record<string, number>));
    const size = tiers[tiers.length - 1]?.pieces || 5;
    setBonuses.push({ set: s.name, setId: s.id, pieces: Math.min(n, size), size, bonus, tiers });
  }
  const skills = db
    .prepare(`SELECT cs.skill_id, s.stats FROM character_skills cs JOIN skills s ON s.id = cs.skill_id WHERE cs.character_id = ?`)
    .all(character.id) as { skill_id: string; stats: string }[];
  const talentIds: string[] = [];
  for (const sk of skills) {
    if (!isTalentId(sk.skill_id)) continue;
    talentIds.push(sk.skill_id);
    stats = addStats(stats, sanitizeStats(JSON.parse(sk.stats || "{}")));
  }
  if (talentIds.includes("iron_skin")) stats.armor = Math.round(stats.armor * 1.15);
  if (talentIds.includes("heavy_hand")) stats.damage = Math.round(stats.damage * 1.2);
  if (talentIds.includes("arcane_might")) stats.magicDamage = Math.round(stats.magicDamage * 1.2);
  const maxHp = Math.max(20, Math.round(stats.health));
  return { stats, maxHp, setBonuses, gear, isMagic, magicSchool, talentIds };
}

export type LogLine = {
  t: number;
  text: string;
  key: string;
  vars: Record<string, string | number>;
};

function line(t: number, key: string, vars: Record<string, string | number> = {}): LogLine {
  return { t, key, vars, text: key };
}

function wrap(c: Combatant): Unit {
  const maxHp = Math.max(1, Math.round(c.maxHp));
  const talents = new Set(c.talents || []);
  const thorns = Math.max(0, Math.round(c.stats.thorns || 0)) + (talents.has("spiked_armor") ? 5 : 0);
  return {
    ...c,
    maxHp,
    hp: Math.min(Math.max(0, c.hp), maxHp),
    armorPool: Math.max(0, Math.round(c.stats.armor || 0)),
    barrier: Math.max(0, Math.round(c.stats.barrier || 0)),
    thorns,
    poison: 0,
    bleed: 0,
    burnHits: 0,
    burnDmg: 0,
    frozen: false,
    isMagic: !!c.isMagic,
    magicSchool: c.magicSchool || null,
    talents,
    ironWillUsed: false,
  };
}

function applyRaw(who: Unit, amount: number) {
  const dmg = Math.max(0, Math.round(amount));
  const soak = Math.min(who.armorPool, dmg);
  who.armorPool -= soak;
  const hpHit = dmg - soak;
  who.hp -= hpHit;
  return { hpHit, soak, dmg };
}

export function simulateCombat(playerIn: Combatant, enemies: Combatant | Combatant[]) {
  const player = wrap(playerIn);
  const foes = (Array.isArray(enemies) ? enemies : [enemies]).map(wrap);
  const log: LogLine[] = [];
  let tick = 0;

  const living = () => foes.filter((f) => f.hp > 0);
  const firstLiving = () => living()[0];

  function hitOne(att: Unit, def: Unit, incoming: number, physical: boolean) {
    const miss = { hpHit: 0, thorns: null as { att: Unit; def: Unit; th: number } | null };
    if (def.hp <= 0 || att.hp <= 0) return miss;
    let dmgIn = incoming;
    if (def.talents.has("veteran") && def.hp / def.maxHp > 0.8) dmgIn *= 0.95;
    const dodge =
      (def.stats.dodge || 0) + (def.talents.has("last_bastion") && def.hp / def.maxHp < 0.3 ? 20 : 0);
    if (Math.random() * 100 < dodge) {
      log.push(line(tick, "combat.dodges", { name: def.name, id: def.id || def.name }));
      log.push(
        line(tick, "combat.strike", {
          att: att.name,
          def: def.name,
          attId: att.id || att.name,
          defId: def.id || def.name,
          dealt: 0,
          armor: def.armorPool,
          barrier: def.barrier,
        })
      );
      return miss;
    }
    if (def.barrier > 0) {
      def.barrier -= 1;
      log.push(line(tick, "combat.barrier", { name: def.name, id: def.id || def.name, left: def.barrier }));
      log.push(
        line(tick, "combat.strike", {
          att: att.name,
          def: def.name,
          attId: att.id || att.name,
          defId: def.id || def.name,
          dealt: 0,
          armor: def.armorPool,
          barrier: def.barrier,
        })
      );
      return miss;
    }
    const hadArmor = def.armorPool > 0;
    const { hpHit, soak } = applyRaw(def, dmgIn);
    if (hadArmor && def.armorPool <= 0 && def.talents.has("iron_will") && !def.ironWillUsed) {
      def.ironWillUsed = true;
      def.barrier += 1;
      log.push(line(tick, "combat.barrier", { name: def.name, id: def.id || def.name, left: def.barrier }));
    }
    if (hpHit > 0 || soak > 0) {
      if (soak > 0) {
        log.push(line(tick, "combat.armor", { name: def.name, id: def.id || def.name, n: soak, left: def.armorPool }));
      }
      log.push(
        line(tick, "combat.strike", {
          att: att.name,
          def: def.name,
          attId: att.id || att.name,
          defId: def.id || def.name,
          dealt: hpHit,
          soak,
          armor: def.armorPool,
          barrier: def.barrier,
        })
      );
    }
    let thorns: { att: Unit; def: Unit; th: number } | null = null;
    if (physical && def.thorns > 0 && att.hp > 0) {
      const th = def.thorns;
      def.thorns -= 1;
      att.hp -= th;
      thorns = { att, def, th };
    }
    return { hpHit, thorns };
  }

  function applyOnHit(att: Unit, def: Unit) {
    if (def.hp <= 0) return;
    const pChance = att.stats.poisonChance || (att.stats.poison ? 30 : 0);
    if ((att.stats.poison || 0) > 0 && Math.random() * 100 < pChance) {
      def.poison += Math.round(att.stats.poison);
      log.push(line(tick, "combat.poison", { name: def.name, id: def.id || def.name, n: def.poison }));
    }
    const bChance = att.stats.bleedChance || (att.stats.bleed ? 30 : 0);
    if ((att.stats.bleed || 0) > 0 && Math.random() * 100 < bChance) {
      def.bleed += Math.round(att.stats.bleed);
      log.push(line(tick, "combat.bleed", { name: def.name, id: def.id || def.name, n: def.bleed }));
    }
    if (att.magicSchool === "fire" && Math.random() < 0.3) {
      def.burnHits = 3;
      def.burnDmg = Math.max(1, Math.round((att.stats.magicDamage || 0) * 0.3));
      log.push(line(tick, "combat.burn", { name: def.name, id: def.id || def.name, n: def.burnHits }));
    }
    const burn = att.burnOnHit;
    if (burn && burn.dmg > 0 && burn.hits > 0 && Math.random() * 100 < burn.chance) {
      def.burnHits = burn.hits;
      def.burnDmg = Math.max(1, Math.round(burn.dmg));
      log.push(line(tick, "combat.burn", { name: def.name, id: def.id || def.name, n: def.burnHits }));
    }
    if (att.magicSchool === "frost" && Math.random() < 0.3) {
      def.frozen = true;
      log.push(line(tick, "combat.freeze", { name: def.name, id: def.id || def.name }));
    }
  }

  function attack(att: Unit, primary: Unit) {
    const physical = !att.isMagic;
    let base = att.isMagic ? att.stats.magicDamage || 0 : att.stats.damage || 0;
    if (att.talents.has("berserk")) {
      const missing = Math.max(0, 1 - att.hp / att.maxHp);
      base *= 1 + Math.floor(missing / 0.1) * 0.05;
    }
    if (att.talents.has("finisher") && primary.hp / primary.maxHp < 0.25) base *= 1.2;
    if ((att.heavyPct || 0) > 0) base *= 1 + att.heavyPct! / 100;
    let crit = false;
    if (Math.random() * 100 < (att.stats.critChance || 0)) {
      base *= (att.stats.critDamage || 150) / 100;
      crit = true;
      log.push(line(tick, "combat.crit"));
    }
    base = Math.max(1, Math.round(base));

    const targets: { u: Unit; portion: number }[] = [{ u: primary, portion: 1 }];
    if (att.magicSchool === "chain") {
      const others = living().filter((f) => f !== primary && f !== att);
      others.forEach((u, i) => targets.push({ u, portion: Math.max(0, 1 - 0.3 * (i + 1)) }));
      if (targets.length > 1) log.push(line(tick, "combat.chain"));
    }

    let totalHp = 0;
    const thornHits: { att: Unit; def: Unit; th: number }[] = [];
    for (const { u, portion } of targets) {
      if (portion <= 0 || u.hp <= 0) continue;
      const hit = hitOne(att, u, Math.max(1, Math.round(base * portion)), physical);
      totalHp += hit.hpHit;
      if (hit.thorns) thornHits.push(hit.thorns);
    }
    applyOnHit(att, primary);
    for (const t of thornHits) {
      log.push(
        line(tick, "combat.thorns", {
          att: t.att.name,
          attId: t.att.id || t.att.name,
          def: t.def.name,
          defId: t.def.id || t.def.name,
          dmg: t.th,
          left: t.def.thorns,
        })
      );
    }
    if (crit && att.talents.has("bloodlust") && att.hp > 0) {
      const wanted = Math.max(1, Math.round(att.maxHp * 0.02));
      const before = att.hp;
      att.hp = Math.min(att.maxHp, att.hp + wanted);
      const heal = Math.round(att.hp - before);
      if (heal > 0) log.push(line(tick, "combat.leech", { att: att.name, attId: att.id || att.name, ls: heal }));
    }
    const lsWanted = Math.round(totalHp * (att.stats.lifesteal || 0) / 100);
    if (lsWanted > 0 && att.hp > 0) {
      const before = att.hp;
      att.hp = Math.min(att.maxHp, att.hp + lsWanted);
      const ls = Math.round(att.hp - before);
      if (ls > 0) log.push(line(tick, "combat.leech", { att: att.name, attId: att.id || att.name, ls }));
    }
  }

  function startTurn(who: Unit) {
    if (who.hp <= 0) return false;
    if (who.burnHits > 0 && who.burnDmg > 0) {
      const { hpHit, soak } = applyRaw(who, who.burnDmg);
      who.burnHits -= 1;
      if (hpHit > 0 || soak > 0) {
        log.push(line(tick, "combat.dot", { name: who.name, id: who.id || who.name, dmg: hpHit, soak, kind: "BURN", burn: who.burnHits, poison: who.poison, bleed: who.bleed, armor: who.armorPool }));
      }
    }
    if (who.hp > 0 && who.poison > 0) {
      const { hpHit, soak } = applyRaw(who, who.poison);
      who.poison = Math.max(0, who.poison - 1);
      if (hpHit > 0 || soak > 0) {
        log.push(line(tick, "combat.dot", { name: who.name, id: who.id || who.name, dmg: hpHit, soak, kind: "POISON", poison: who.poison, bleed: who.bleed, burn: who.burnHits, armor: who.armorPool }));
      }
    }
    if (who.hp > 0 && who.bleed > 0) {
      const { hpHit, soak } = applyRaw(who, who.bleed);
      who.bleed = Math.max(0, who.bleed - 1);
      if (hpHit > 0 || soak > 0) {
        log.push(line(tick, "combat.dot", { name: who.name, id: who.id || who.name, dmg: hpHit, soak, kind: "BLEED", poison: who.poison, bleed: who.bleed, burn: who.burnHits, armor: who.armorPool }));
      }
    }
    if (who.hp <= 0) return false;
    const regen = Math.round(who.stats.regen || 0);
    if (regen > 0 && who.hp < who.maxHp) {
      const before = who.hp;
      who.hp = Math.min(who.maxHp, who.hp + regen);
      const gained = Math.round(who.hp - before);
      if (gained > 0) log.push(line(tick, "combat.regen", { name: who.name, id: who.id || who.name, hp: gained }));
    }
    if (who.frozen) {
      who.frozen = false;
      log.push(line(tick, "combat.skip", { name: who.name, id: who.id || who.name }));
      return false;
    }
    return true;
  }

  const packName = foes.map((f) => f.name).join(", ");
  log.push(line(0, "combat.faces", { player: player.name, enemy: packName, enemyId: foes[0]?.id || packName }));

  while (player.hp > 0 && living().length && tick < 400) {
    tick++;
    if (startTurn(player)) {
      const tgt = firstLiving();
      if (tgt) attack(player, tgt);
    }
    if (player.hp <= 0 || !living().length) break;
    for (const f of [...foes]) {
      if (f.hp <= 0 || player.hp <= 0) continue;
      if (startTurn(f)) attack(f, player);
    }
  }

  const won = living().length === 0 && player.hp > 0;
  if (won) log.push(line(tick, "combat.falls", { name: packName, id: foes[0]?.id || packName }));
  else log.push(line(tick, "combat.fallen", { name: player.name, id: player.id || player.name }));
  return {
    won,
    log,
    ticks: tick,
    playerHp: Math.max(0, Math.round(player.hp)),
    enemyHp: Math.max(0, Math.round(foes[0]?.hp ?? 0)),
  };
}
