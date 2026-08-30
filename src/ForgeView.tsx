import { useEffect, useMemo, useState } from "react";
import type { Item } from "./api";
import { api } from "./api";
import { ItemFace, ItemTooltip } from "./ui";
import { useI18n } from "./i18n";

const ORE_FOR: Record<string, string> = {
  Common: "ore_copper",
  Uncommon: "ore_iron",
  Rare: "ore_gold",
  Epic: "ore_mithril",
  Legendary: "ore_adamantite",
};

const FORGE_COST: Record<string, number> = {
  Common: 25,
  Uncommon: 60,
  Rare: 140,
  Epic: 320,
  Legendary: 750,
};

function HammerMark() {
  return (
    <svg className="forge-hammer" viewBox="0 0 24 24" fill="none" stroke="#c4a35a" strokeWidth="1.6" aria-hidden>
      <path d="M5 8 H19 V12 H5 Z" />
      <path d="M11 12 L11 21" />
      <path d="M4 8 C4 5 8 5 8 8" />
    </svg>
  );
}

export function ForgeView({
  pack,
  slots,
  setSlots,
  charLevel,
  coins,
  onClose,
  reload,
  setErr,
}: {
  pack: Item[];
  slots: (string | null)[];
  setSlots: (next: (string | null)[]) => void;
  charLevel: number;
  coins: number;
  onClose: () => void;
  reload: () => Promise<void>;
  setErr: (s: string) => void;
}) {
  const { t, te } = useI18n();
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState<{ item: Item; x: number; y: number } | null>(null);

  const byId = useMemo(() => new Map(pack.map((i) => [i.id, i])), [pack]);
  const filled = slots.map((id) => (id ? byId.get(id) || null : null));
  const ready = filled.every(Boolean);
  const sample = filled.find(Boolean) || null;
  const same =
    ready &&
    sample?.definition.category !== "ore" &&
    filled.every(
      (it) => it && sample && it.definition_id === sample.definition_id && it.rarity === sample.rarity
    );
  const cost = sample ? FORGE_COST[sample.rarity] : null;
  const canPay = cost != null && coins >= cost;
  const maxed = sample?.rarity === "Mythic" || (sample && FORGE_COST[sample.rarity] == null);
  const oreDef = sample ? ORE_FOR[sample.rarity] : null;
  const hasOre = !!(oreDef && pack.some((i) => i.definition_id === oreDef && !slots.includes(i.id)));

  useEffect(() => {
    const ids = new Set(pack.map((i) => i.id));
    setHover((h) => (h && ids.has(h.item.id) && slots.includes(h.item.id) ? h : null));
  }, [pack, slots]);

  function clearId(id: string) {
    setSlots(slots.map((s) => (s === id ? null : s)));
  }

  function dropOn(i: number, id: string) {
    const it = byId.get(id);
    if (it?.definition.category === "ore") return;
    const next = slots.map((s) => (s === id ? null : s));
    next[i] = id;
    setSlots(next);
  }

  async function forge() {
    if (!same || !cost || maxed || busy) return;
    setBusy(true);
    try {
      await api("/forge", { method: "POST", body: { ids: slots } });
      setSlots([null, null, null]);
      await reload();
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "No"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel center-pane stall-pane">
      <div className="stall-head">
        <div className="stall-head-ico" aria-hidden>
          ⚒
        </div>
        <div className="stall-head-copy">
          <h2>{t("forge")}</h2>
          <p>
            {t("forgePackHint")}{" "}
            <span className="stall-coins">({t("stallCoinsOnHand", { n: coins })})</span>
          </p>
        </div>
      </div>
      <div className="forge-frame">
        <div className="forge-anvil">
          <div className="forge-triangle">
            {([0, 1, 2] as const).map((i) => {
              const it = filled[i];
              return (
                <div
                  key={i}
                  className={`eq-slot cell forge-slot pos-${i} ${it ? `has-item filled r-${it.rarity}` : ""}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/item");
                    if (id) dropOn(i, id);
                  }}
                  onClick={() => {
                    if (!it) return;
                    setHover(null);
                    clearId(it.id);
                  }}
                  onMouseEnter={(e) => it && setHover({ item: it, x: e.clientX, y: e.clientY })}
                  onMouseMove={(e) => it && setHover({ item: it, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHover(null)}
                >
                  {it ? (
                    <div style={{ position: "absolute", inset: 0, cursor: "pointer" }}>
                      <ItemFace item={it} />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
        <p className="forge-status">
          {maxed
            ? t("forgeMax")
            : same && !hasOre
              ? t("forgeNeedOre", { ore: t(`ore_${sample!.rarity}`) })
              : same
                ? t("forgePay", { n: cost || 0, rarity: t(`rarity_${sample!.rarity}`) })
                : t("forgeHint")}
        </p>
      </div>
      {hover ? <ItemTooltip item={hover.item} x={hover.x} y={hover.y} charLevel={charLevel} /> : null}
      <div className="stall-actions">
        <button
          type="button"
          className="stall-act"
          disabled={!same || !canPay || !!maxed || !hasOre || busy}
          onClick={() => void forge()}
        >
          <span>{t("forgeDo")}</span>
          {cost != null ? <em>{cost}</em> : null}
        </button>
        <button type="button" className="stall-act ghost" onClick={onClose}>
          <span>{t("backSquare")}</span>
        </button>
      </div>
    </div>
  );
}

export function putForgeSlot(slots: (string | null)[], id: string): (string | null)[] {
  if (slots.includes(id)) return slots.map((s) => (s === id ? null : s));
  const i = slots.findIndex((s) => !s);
  if (i < 0) return slots;
  const next = slots.slice();
  next[i] = id;
  return next;
}
