import { db } from "../db.ts";
import { generateInstance, itemValue, type InstanceRow } from "./items.ts";
import { rollRarity } from "./items.ts";
import { RARITIES } from "./stats.ts";
import { dropKindOf, weightsFor } from "./dropTables.ts";

export function rollLoot(opts: {
  userId: string;
  characterId: string;
  region: number;
  enemyKind: string;
  luck: number;
  depth?: number;
}) {
  const defs = db.prepare("SELECT id, required_level FROM item_definitions WHERE required_level <= ? AND slot IS NOT NULL AND slot != ''").all(opts.region * 6 + 8) as {
    id: string;
    required_level: number;
  }[];
  const rarityWeights = weightsFor(opts.depth || 0, dropKindOf(opts.enemyKind));
  const items: InstanceRow[] = [];
  const used = new Set<string>();
  for (let i = 0; i < 3; i++) {
    if (!defs.length) break;
    const pool = defs.filter((d) => !used.has(d.id));
    const pick = (pool.length ? pool : defs)[Math.floor(Math.random() * (pool.length ? pool.length : defs.length))]!;
    used.add(pick.id);
    const inst = generateInstance({
      definitionId: pick.id,
      ownerUserId: opts.userId,
      ownerCharacterId: opts.characterId,
      location: "GROUND",
      region: opts.region,
      luck: opts.luck,
      rarityWeights,
    });
    items.push(inst);
    db.prepare("INSERT INTO ground_loot (character_id, instance_id) VALUES (?, ?)").run(opts.characterId, inst.id);
  }
  const gold =
    Math.round((8 + opts.region * 6) * (1 + opts.luck / 100) * (opts.enemyKind === "boss" ? 4 : opts.enemyKind === "elite" ? 2 : 1) * (0.7 + Math.random() * 0.6));
  return { items, gold };
}

export function clearGround(characterId: string) {
  const rows = db.prepare("SELECT instance_id FROM ground_loot WHERE character_id = ?").all(characterId) as { instance_id: string }[];
  for (const r of rows) {
    const it = db.prepare("SELECT location FROM item_instances WHERE id = ?").get(r.instance_id) as { location: string } | undefined;
    if (it?.location === "GROUND") {
      db.prepare("UPDATE item_instances SET location = 'DESTROYED', destroyed_at = ? WHERE id = ?").run(Date.now(), r.instance_id);
    }
  }
  db.prepare("DELETE FROM ground_loot WHERE character_id = ?").run(characterId);
}

export { itemValue, rollRarity, RARITIES };
