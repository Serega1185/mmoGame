import { db } from "../db.ts";
import { generateInstance, itemValue, type InstanceRow } from "./items.ts";
import { rollRarity } from "./items.ts";
import { RARITIES, type Rarity } from "./stats.ts";
import { dropKindOf, weightsFor, withLuck } from "./dropTables.ts";

export function rollLoot(opts: {
  userId: string;
  characterId: string;
  region: number;
  enemyKind: string;
  luck: number;
  depth?: number;
}) {
  const defs = db
    .prepare(
      "SELECT id, required_level, rarity_min FROM item_definitions WHERE required_level <= ? AND slot IS NOT NULL AND slot != '' AND IFNULL(category,'') != 'ore'"
    )
    .all(opts.region * 6 + 8) as { id: string; required_level: number; rarity_min: string }[];
  const rarityWeights = withLuck(weightsFor(opts.depth || 1, dropKindOf(opts.enemyKind)), opts.luck);
  const items: InstanceRow[] = [];
  const used = new Set<string>();
  const minIdxOf = (min: string) => {
    const i = RARITIES.indexOf(min as Rarity);
    return i < 0 ? 0 : i;
  };
  for (let n = 0; n < 3; n++) {
    if (!defs.length) break;
    const rarity = rollRarity(0, undefined, rarityWeights);
    const rIdx = RARITIES.indexOf(rarity);
    let pool = defs.filter((d) => !used.has(d.id) && minIdxOf(d.rarity_min) <= rIdx);
    if (!pool.length) pool = defs.filter((d) => minIdxOf(d.rarity_min) <= rIdx);
    if (!pool.length) pool = defs.filter((d) => !used.has(d.id));
    if (!pool.length) pool = defs;
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    used.add(pick.id);
    const inst = generateInstance({
      definitionId: pick.id,
      ownerUserId: opts.userId,
      ownerCharacterId: opts.characterId,
      location: "GROUND",
      region: opts.region,
      forceRarity: rarity,
    });
    items.push(inst);
    db.prepare("INSERT INTO ground_loot (character_id, instance_id) VALUES (?, ?)").run(opts.characterId, inst.id);
  }
  return { items, gold: 0 };
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
