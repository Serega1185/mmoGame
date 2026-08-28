import type { Item } from "./api";
import { PCT, STAT_LABEL } from "./api";

export function Glyph({ kind, size = 22 }: { kind: string; size?: number }) {
  const s = size;
  const stroke = "#d7c39a";
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.6">
      {kind === "sword" || kind === "greatsword" ? <path d="M14 4 L19 9 L10 18 L6 20 L8 16 Z M9 15 L6 12" /> : null}
      {kind === "axe" || kind === "halberd" ? <path d="M12 3 L12 21 M12 6 C18 6 18 14 12 14" /> : null}
      {kind === "hammer" || kind === "mace" ? <path d="M12 8 L12 21 M7 8 H17 V12 H7 Z" /> : null}
      {kind === "bow" ? <path d="M6 4 C18 8 18 16 6 20 M6 4 L6 20 M8 12 H18" /> : null}
      {kind === "crossbow" ? <path d="M4 12 H20 M12 4 V16 M8 8 H16" /> : null}
      {kind === "spear" ? <path d="M12 2 L12 22 M9 6 L12 2 L15 6" /> : null}
      {kind === "knife" || kind === "dagger" ? <path d="M14 3 L18 7 L10 18 L7 19 L8 16 Z" /> : null}
      {kind === "pick" ? <path d="M12 10 L12 22 M5 10 C5 4 19 4 19 10 H5" /> : null}
      {kind === "shovel" ? <path d="M12 2 L12 14 M8 14 H16 L14 21 H10 Z" /> : null}
      {kind === "sickle" ? <path d="M12 20 L12 10 C12 4 20 4 20 10" /> : null}
      {kind === "shield" ? <path d="M12 3 L20 6 V12 C20 17 12 21 12 21 C12 21 4 17 4 12 V6 Z" /> : null}
      {kind === "helm" || kind === "hood" || kind === "mask" ? <path d="M6 14 C6 7 18 7 18 14 V18 H6 Z M9 18 V15 M15 18 V15" /> : null}
      {kind === "chest" || kind === "mail" || kind === "plate" || kind === "cloak" ? <path d="M8 6 L12 4 L16 6 L19 10 V20 H5 V10 Z" /> : null}
      {kind === "gloves" ? <path d="M7 20 V10 L9 8 V6 M11 20 V8 M14 20 V8 M17 18 V11" /> : null}
      {kind === "legs" ? <path d="M8 4 H16 L15 10 L18 22 H14 L12 12 L10 22 H6 L9 10 Z" /> : null}
      {kind === "boots" ? <path d="M8 8 H12 V16 H18 V20 H7 V12 Z" /> : null}
      {kind === "ring" ? <circle cx="12" cy="12" r="6" /> : null}
      {kind === "neck" || kind === "charm" ? <path d="M8 6 C8 2 16 2 16 6 L14 12 H10 Z" /> : null}
      {kind === "potion" || kind === "vial" ? <path d="M10 4 H14 V8 L17 18 H7 L10 8 Z" /> : null}
      {kind === "torch" ? <path d="M12 10 L12 22 M9 8 C9 4 15 4 15 8 C12 11 9 8 9 8" /> : null}
      {kind === "censer" ? <path d="M8 8 H16 L14 18 H10 Z M12 4 V8 M8 4 H16" /> : null}
      {kind === "bag" ? <path d="M7 9 H17 L16 20 H8 Z M9 9 C9 6 15 6 15 9" /> : null}
      {kind === "hook" ? <path d="M8 4 L8 16 C8 20 16 20 16 14" /> : null}
      {kind === "staff" ? <path d="M12 22 L12 6 M12 6 C16 6 16 2 12 2" /> : null}
      {kind === "stone" ? <path d="M6 16 L10 8 L16 10 L18 17 Z" /> : null}
      {!["sword","greatsword","axe","halberd","hammer","mace","bow","crossbow","spear","knife","dagger","pick","shovel","sickle","shield","helm","hood","mask","chest","mail","plate","cloak","gloves","legs","boots","ring","neck","charm","potion","vial","torch","censer","bag","hook","staff","stone"].includes(kind) ? (
        <rect x="6" y="6" width="12" height="12" />
      ) : null}
    </svg>
  );
}

export function fmtStat(k: string, v: number) {
  const n = Math.round(v * 10) / 10;
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n}${PCT.has(k) ? "%" : ""} ${STAT_LABEL[k] || k}`;
}

export function ItemTooltip({ item, x, y, charLevel }: { item: Item; x: number; y: number; charLevel?: number }) {
  const locked = charLevel != null && item.required_level > charLevel;
  return (
    <div className={`tooltip parchment r-${item.rarity}`} style={{ left: Math.min(x + 12, window.innerWidth - 280), top: Math.min(y + 12, window.innerHeight - 220) }}>
      <div className="rarity">{item.rarity}</div>
      <strong>{item.definition.name}</strong>
      <div>Item Level {item.item_level}</div>
      <div className={locked ? "req" : ""}>
        Required Level: {item.required_level}
        {locked ? `  —  YOUR LEVEL: ${charLevel}` : ""}
      </div>
      {item.definition.slot ? <div>Slot: {item.definition.slot}</div> : null}
      {item.set ? <div>Set: {item.set.name}</div> : null}
      <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem" }}>
        {Object.entries(item.stats)
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <li key={k}>{fmtStat(k, v)}</li>
          ))}
      </ul>
      <em style={{ display: "block", marginTop: 6, fontSize: "0.82rem" }}>{item.definition.flavor}</em>
      <div className="muted">Value {item.value} crowns · {item.width}×{item.height}</div>
    </div>
  );
}

export function ItemFace({ item, w, h }: { item: Item; w: number; h: number }) {
  return (
    <div className={`item-tile r-${item.rarity}`} style={{ width: w, height: h }} title={item.definition.name}>
      <div>
        <Glyph kind={item.definition.glyph} />
        <div style={{ fontSize: 9, lineHeight: 1.1 }}>{item.definition.name}</div>
      </div>
    </div>
  );
}
