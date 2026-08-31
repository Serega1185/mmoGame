import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Item } from "./api";
import { PCT, STAT_KEYS, STAT_LABEL } from "./api";
import { useI18n } from "./i18n";
import { itemIconSrc, SET_MARK } from "./itemIcons";

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
      {kind === "staff" || kind === "wand" ? <path d="M12 22 L12 6 M12 6 C16 6 16 2 12 2" /> : null}
      {kind === "stone" ? <path d="M6 16 L10 8 L16 10 L18 17 Z" /> : null}
      {!["sword","greatsword","axe","halberd","hammer","mace","bow","crossbow","spear","knife","dagger","pick","shovel","sickle","shield","helm","hood","mask","chest","mail","plate","cloak","gloves","legs","boots","ring","neck","charm","potion","vial","torch","censer","bag","hook","staff","wand","stone"].includes(kind) ? (
        <rect x="6" y="6" width="12" height="12" />
      ) : null}
    </svg>
  );
}

export function fmtStat(k: string, v: number, label?: string) {
  const n = Math.round(v * 10) / 10;
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n}${PCT.has(k) ? "%" : ""} ${label || STAT_LABEL[k] || k}`;
}

export function statEntries(stats: Record<string, number>) {
  const seen = new Set<string>();
  const out: [string, number][] = [];
  for (const k of STAT_KEYS) {
    const v = stats[k];
    if (v) {
      out.push([k, v]);
      seen.add(k);
    }
  }
  for (const [k, v] of Object.entries(stats)) {
    if (v && !seen.has(k)) out.push([k, v]);
  }
  return out;
}

export function HintTooltip({ title, text, x, y }: { title?: string; text?: string; x: number; y: number }) {
  return (
    <div
      className="tooltip parchment tip-short"
      style={{ left: Math.min(x + 12, window.innerWidth - 280), top: Math.min(y + 14, window.innerHeight - 140) }}
    >
      {title ? <strong>{title}</strong> : null}
      {text ? (
        <div className={title ? "muted" : undefined} style={title ? { marginTop: 4 } : undefined}>
          {text}
        </div>
      ) : null}
    </div>
  );
}

export function HoverHint({
  title,
  text,
  className,
  as: Tag = "div",
  children,
}: {
  title?: string;
  text?: string;
  className?: string;
  as?: "div" | "span";
  children: ReactNode;
}) {
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <Tag
        className={className}
        onPointerEnter={(e) => setTip({ x: e.clientX, y: e.clientY })}
        onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY })}
        onPointerLeave={() => setTip(null)}
        onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY })}
        onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setTip(null)}
      >
        {children}
      </Tag>
      {tip && (title || text) ? createPortal(<HintTooltip title={title} text={text} x={tip.x} y={tip.y} />, document.body) : null}
    </>
  );
}

export function ItemTooltip({ item, x, y, charLevel }: { item: Item; x: number; y: number; charLevel?: number }) {
  const { t, itemName, itemFlavor, setName } = useI18n();
  const flavor = itemFlavor(item);
  const [alt, setAlt] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Alt") setAlt(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Alt") setAlt(false);
    };
    const blur = () => setAlt(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
  const locked = charLevel != null && item.required_level > charLevel;
  const school = item.magicSchool || (item.definition.tags || []).find((x) => x === "chain" || x === "fire" || x === "frost");
  return (
    <div className={`tooltip parchment item-tip r-${item.rarity}`} style={{ left: Math.min(x + 12, window.innerWidth - 300), top: Math.min(y + 12, window.innerHeight - 340) }}>
      <div className="rarity">{t(`rarity_${item.rarity}`)}</div>
      <strong>{itemName(item)}</strong>
      {flavor ? <div className="muted">{flavor}</div> : null}
      {school ? (
        <div className="school-block">
          <div>{t(`school_${school}`)}</div>
          <div className="muted school-desc">{t(`schoolDesc_${school}`)}</div>
        </div>
      ) : null}
      <div className={locked ? "req" : ""}>
        {t("requiredLevel", { n: item.required_level })}
        {locked ? `  —  ${t("yourLevel", { n: charLevel! })}` : ""}
      </div>
      {item.definition.slot ? <div>{t("slot")}: {t(`slot_${item.definition.slot}`) || item.definition.slot}</div> : null}
      {item.set ? (
        <div className="tip-set">
          {t("set")}: <span className="set-mark">{SET_MARK[item.set.id] || "◆"}</span>{setName(item.set.id || item.set.name)}
        </div>
      ) : null}
      <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem" }}>
        {statEntries(item.stats).map(([k, v]) => {
          const range = item.statRanges?.[k];
          const label = t(`stat_${k}`);
          if (alt && range) {
            const pct = PCT.has(k) ? "%" : "";
            return (
              <li key={k}>
                {fmtStat(k, v, label)}{" "}
                <span className="muted">
                  ({range.min}
                  {pct}–{range.max}
                  {pct})
                </span>
              </li>
            );
          }
          return <li key={k}>{fmtStat(k, v, label)}</li>;
        })}
      </ul>
      <div className="muted">{t("holdAlt")}</div>
      <div className="muted">{t("valueCrowns", { n: item.value })}</div>
    </div>
  );
}

export type SetTip = {
  set: string;
  setId?: string;
  pieces: number;
  size?: number;
  tiers?: { pieces: number; bonus: Record<string, number> }[];
};

export function SetTooltip({ set: s, x, y }: { set: SetTip; x: number; y: number }) {
  const { t, setName } = useI18n();
  const size = s.size || s.tiers?.[s.tiers.length - 1]?.pieces || 5;
  const tiers = s.tiers?.length
    ? s.tiers
    : [
        { pieces: 2, bonus: {} },
        { pieces: 5, bonus: {} },
      ];
  return (
    <div
      className="tooltip parchment set-tip"
      style={{ left: Math.min(x + 14, window.innerWidth - 300), top: Math.min(y + 12, window.innerHeight - 260) }}
    >
      <strong>
        <span className="set-mark">{SET_MARK[s.setId || ""] || "◆"}</span> {setName(s.setId || s.set)}
      </strong>
      <div className="set-count">
        {t("setCollected", { have: s.pieces, need: size })}
      </div>
      {tiers.map((tier) => {
        const on = s.pieces >= tier.pieces;
        const stats = Object.entries(tier.bonus).filter(([, v]) => v);
        return (
          <div key={tier.pieces} className={`set-tier ${on ? "on" : "off"}`}>
            <div className="set-tier-n">{t("setBonusN", { n: tier.pieces })}</div>
            {stats.length ? (
              <ul>
                {stats.map(([k, v]) => (
                  <li key={k}>{fmtStat(k, v, t(`stat_${k}`))}</li>
                ))}
              </ul>
            ) : (
              <div className="muted">{t("setNoBonus")}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function HeroFace({ icon, alt = "", className = "" }: { icon?: string; alt?: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [icon]);
  const src = icon && !broken ? icon : "";
  if (!src) {
    return (
      <div className={`hero-face stub-face ${className}`.trim()} title={alt || undefined} aria-hidden={!alt}>
        <svg viewBox="0 0 48 64" fill="none" stroke="#8a7a58" strokeWidth="1.6" aria-hidden>
          <circle cx="24" cy="16" r="8" />
          <path d="M10 58 C10 38 38 38 38 58" />
          <path d="M18 28 L14 44 M30 28 L34 44" />
        </svg>
      </div>
    );
  }
  return <img className={`hero-face ${className}`.trim()} src={src} alt={alt} onError={() => setBroken(true)} />;
}

export function ItemFace({ item }: { item: Item }) {
  const { t, itemName } = useI18n();
  const name = itemName(item);
  const glyph = item.definition.glyph;
  const ore = !item.definition.icon && (glyph === "stone" || (item.definition.tags || []).includes("ore"));
  const req = Math.max(1, Number(item.required_level) || 1);
  return (
    <div className={`item-tile r-${item.rarity}`}>
      {ore ? <Glyph kind="stone" size={32} /> : <img className="item-art" src={itemIconSrc(item)} alt={name} draggable={false} />}
      <span className="item-req">{t("itemReqShort", { n: req })}</span>
    </div>
  );
}
