import type { Item } from "./api";

function weight(tags: string[], glyph: string): "heavy" | "medium" | "light" {
  if (tags.includes("plate") || tags.includes("mail")) return "heavy";
  if (tags.includes("cloth") || glyph === "hood" || glyph === "cloak") return "light";
  return "medium";
}

function fileFor(item: Item): string {
  const glyph = item.definition.glyph;
  const tags = item.definition.tags || [];
  const slot = item.definition.slot || "";
  const twohand = tags.includes("twohand") || glyph === "greatsword" || glyph === "halberd";
  const w = weight(tags, glyph);

  if (glyph === "bow" || tags.includes("bow")) return "bow_01.png";
  if (glyph === "crossbow" || tags.includes("crossbow")) return "crossbow_01.png";
  if (glyph === "spear" || tags.includes("spear")) return "spears_01.png";
  if (glyph === "halberd") return "halberd_01.png";
  if (glyph === "dagger" || tags.includes("dagger")) return "dagger_01.png";
  if (glyph === "knife") return "knive_01.png";
  if (glyph === "hammer" || glyph === "mace" || tags.includes("hammer") || tags.includes("mace")) return "blunt_weapon_01.png";
  if (glyph === "axe" || tags.includes("axe")) return twohand || (item.height || 1) > 2 ? "two-handed_axe_01.png" : "one-handed_axe_01.png";
  if (glyph === "greatsword") return "two-handed_sword_01.png";
  if (glyph === "sword" || tags.includes("sword")) return twohand ? "two-handed_sword_01.png" : "one-handed_sword_01.png";
  if (glyph === "pick" || glyph === "shovel" || glyph === "sickle" || glyph === "staff" || glyph === "wand" || glyph === "hook" || glyph === "censer") return "polearms_01.png";
  if (glyph === "shield" || slot === "Offhand") return tags.includes("plate") ? "shield_02.png" : "shield_01.png";
  if (glyph === "helm" || glyph === "hood" || glyph === "mask" || slot === "Head") return `${w}_helmets_01.png`;
  if (glyph === "chest" || glyph === "mail" || glyph === "plate" || glyph === "cloak" || slot === "Chest") return `${w}_cuirasses_01.png`;
  if (glyph === "gloves" || slot === "Gloves") return `${w}_gauntlets_01.png`;
  if (glyph === "legs" || slot === "Legs") return `${w}_leg_01.png`;
  if (glyph === "boots" || slot === "Boots") return `${w}_boots_01.png`;
  if (glyph === "bag" || glyph === "charm") return `${w}_belt_01.png`;
  if (glyph === "ring" || glyph === "neck" || slot === "Neck" || slot === "Ring1" || slot === "Ring2") return "light_belt_01.png";
  if (glyph === "potion" || glyph === "vial" || glyph === "torch") return "knive_01.png";
  return "one-handed_sword_01.png";
}

export function itemIconSrc(item: Item) {
  const custom = item.definition.icon;
  if (custom) return custom;
  return `/assets/64x64/${fileFor(item)}`;
}

export const SET_MARK: Record<string, string> = {
  oathbound: "🛡",
  redhowl: "🐺",
  briarvigil: "🌿",
  silentcowl: "👁",
  emberreliquary: "🔥",
  gallowsbrand: "👑",
  deepvein: "⛏",
  anvilcovenant: "⚒",
  crimsonthirst: "🩸",
  censerwoe: "☁",
  gravetithe: "☠",
  hearthless: "⌂",
  ironorchard: "🍃",
  nightmarket: "◆",
  stormfen: "💧",
};
