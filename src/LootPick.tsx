import { useState } from "react";
import type { Item } from "./api";
import { api } from "./api";
import { ItemFace, ItemTooltip } from "./ui";
import { useI18n } from "./i18n";

export function LootPick({
  items,
  charLevel,
  onDone,
  setErr,
}: {
  items: Item[];
  charLevel: number;
  onDone: () => Promise<void>;
  setErr: (s: string) => void;
}) {
  const { t, te, itemName } = useI18n();
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [hover, setHover] = useState<{ item: Item; x: number; y: number } | null>(null);

  async function choose(id: string | null) {
    if (busy) return;
    setBusy(true);
    try {
      await api("/game/loot", { method: "POST", body: { instanceId: id } });
      await onDone();
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "Denied"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="loot-pick-back">
      <div className="panel loot-pick">
        <div className="loot-pick-banner">{t("chooseSpoils")}</div>
        <p className="muted loot-pick-hint">{t("chooseSpoilsHint")}</p>
        <div className="loot-pick-row">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              className={`loot-pick-card ${focus === it.id ? "focus" : ""}`}
              disabled={busy}
              onClick={() => choose(it.id)}
              onMouseEnter={(e) => {
                setFocus(it.id);
                setHover({ item: it, x: e.clientX, y: e.clientY });
              }}
              onMouseMove={(e) => setHover({ item: it, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => {
                setFocus(null);
                setHover(null);
              }}
            >
              <div className={`cell has-item filled r-${it.rarity} loot-pick-cell`}>
                <ItemFace item={it} />
              </div>
              <div className={`loot-pick-name r-${it.rarity}`}>{itemName(it)}</div>
              <div className="muted">{t(`rarity_${it.rarity}`)}</div>
            </button>
          ))}
        </div>
        <button disabled={busy} onClick={() => choose(null)}>
          {t("skipSpoils")}
        </button>
      </div>
      {hover ? <ItemTooltip item={hover.item} x={hover.x} y={hover.y} charLevel={charLevel} /> : null}
    </div>
  );
}
