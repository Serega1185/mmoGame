import { db, now } from "../db.ts";

export type TalentDef = {
  id: string;
  name: string;
  description: string;
  stats: Record<string, number>;
};

export const TALENTS: TalentDef[] = [
  { id: "bloodlust", name: "Bloodlust", description: "Each critical hit restores 2% of maximum health.", stats: {} },
  { id: "finisher", name: "Finishing Blow", description: "Deal 20% more damage to foes below 25% health.", stats: {} },
  { id: "berserk", name: "Berserk", description: "For every 10% missing HP, gain +5% damage.", stats: {} },
  { id: "iron_skin", name: "Iron Skin", description: "+15% armor.", stats: {} },
  { id: "veteran", name: "Hardened Veteran", description: "Take 5% less damage while above 80% health.", stats: {} },
  { id: "butcher", name: "Butcher", description: "+5 Bleed.", stats: { bleed: 5 } },
  { id: "poisoner", name: "Poisoner", description: "+5 Poison.", stats: { poison: 5 } },
  { id: "lucky", name: "Lucky", description: "+10% Luck.", stats: { luck: 10 } },
  { id: "heavy_hand", name: "Heavy Hand", description: "+20% physical damage. −10% dodge.", stats: { dodge: -10 } },
  { id: "iron_will", name: "Iron Will", description: "When your armor is fully broken, gain 1 Barrier. Once per fight.", stats: {} },
  { id: "spiked_armor", name: "Spiked Armor", description: "Start each fight with 5 Thorns.", stats: {} },
  { id: "last_bastion", name: "Last Bastion", description: "While below 30% health, gain +20% dodge.", stats: {} },
  { id: "bleeder", name: "Bloodletter", description: "+15% bleed chance.", stats: { bleedChance: 15 } },
  { id: "venom_weapon", name: "Venomous Weapon", description: "+15% poison chance.", stats: { poisonChance: 15 } },
  { id: "arcane_might", name: "Arcane Might", description: "+20% magic damage.", stats: {} },
];

export const TALENT_IDS = TALENTS.map((t) => t.id);
const TALENT_SET = new Set(TALENT_IDS);

export type TalentTree = {
  rows: string[][];
  revealed: number;
  taken: string[];
};

export function isTalentId(id: string) {
  return TALENT_SET.has(id);
}

function shuffle<T>(list: T[]): T[] {
  const x = list.slice();
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = x[i]!;
    x[i] = x[j]!;
    x[j] = t;
  }
  return x;
}

function rollRow(exclude: string[]): string[] {
  const pool = TALENT_IDS.filter((id) => !exclude.includes(id));
  return shuffle(pool).slice(0, Math.min(3, pool.length));
}

export function freshTalentTree(): TalentTree {
  return { rows: [rollRow([]), [], []], revealed: 1, taken: [] };
}

export function parseTalentTree(raw: unknown): TalentTree | null {
  try {
    const t = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!t || !Array.isArray(t.rows) || !Array.isArray(t.taken)) return null;
    const rows = [0, 1, 2].map((i) => (Array.isArray(t.rows[i]) ? t.rows[i].map(String) : []));
    const revealed = Math.min(3, Math.max(1, Number(t.revealed) || 1));
    return { rows, revealed, taken: t.taken.map(String) };
  } catch {
    return null;
  }
}

export function loadPickedTalents(characterId: string): string[] {
  const rows = db
    .prepare("SELECT skill_id FROM character_skills WHERE character_id = ?")
    .all(characterId) as { skill_id: string }[];
  return rows.map((r) => r.skill_id).filter(isTalentId);
}

export function ensureTalentTree(characterId: string, raw: unknown): TalentTree {
  const existing = parseTalentTree(raw);
  if (existing && existing.rows[0]?.length) return existing;
  db.prepare("DELETE FROM character_skills WHERE character_id = ?").run(characterId);
  const tree = freshTalentTree();
  db.prepare("UPDATE characters SET talent_tree = ?, talent_points = COALESCE(talent_points, 0) WHERE id = ?").run(
    JSON.stringify(tree),
    characterId
  );
  return tree;
}

export function canPickTalent(tree: TalentTree, talentId: string) {
  if (!isTalentId(talentId) || tree.taken.includes(talentId)) return false;
  const row = tree.rows.findIndex((r) => r.includes(talentId));
  if (row < 0 || row >= tree.revealed) return false;
  if (tree.taken.length === 0) return row === 0;
  if (tree.taken.length === 1) return row === 1;
  return true;
}

export function applyTalentPick(characterId: string, tree: TalentTree, talentId: string): TalentTree {
  const next: TalentTree = {
    rows: tree.rows.map((r) => r.slice()),
    revealed: tree.revealed,
    taken: [...tree.taken, talentId],
  };
  const shown = next.rows.flat();
  if (next.taken.length === 1 && next.revealed < 2) {
    next.rows[1] = rollRow(shown);
    next.revealed = 2;
  } else if (next.taken.length === 2 && next.revealed < 3) {
    next.rows[2] = rollRow(shown);
    next.revealed = 3;
  }
  db.prepare("INSERT INTO character_skills (character_id, skill_id, picked_at) VALUES (?, ?, ?)").run(
    characterId,
    talentId,
    now()
  );
  db.prepare("UPDATE characters SET talent_tree = ?, talent_points = MAX(0, talent_points - 1) WHERE id = ?").run(
    JSON.stringify(next),
    characterId
  );
  return next;
}
