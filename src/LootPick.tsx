import { useState } from "react";
import type { Item } from "./api";
import { api } from "./api";
import { ItemFace, ItemTooltip } from "./ui";
import { useI18n } from "./i18n";

type FightLogLine = { t?: number; text: string; key?: string; vars?: Record<string, string | number> };

function logTone(key?: string) {
  if (key === "combat.crit") return "crit";
  if (key === "combat.falls" || key === "combat.fallen") return "fall";
  if (
    key === "combat.bleed" ||
    key === "combat.poison" ||
    key === "combat.burn" ||
    key === "combat.freeze" ||
    key === "combat.dot" ||
    key === "combat.thorns" ||
    key === "combat.barrier"
  )
    return "dot";
  return "";
}

export function LootPick({
  items,
  charLevel,
  log,
  onDone,
  setErr,
}: {
  items: Item[];
  charLevel: number;
  log?: FightLogLine[];
  onDone: (ore?: Item | null) => Promise<void>;
  setErr: (s: string) => void;
}) {
  const { t, te, itemName, combatLine } = useI18n();
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [hover, setHover] = useState<{ item: Item; x: number; y: number } | null>(null);

  async function choose(id: string | null) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api<{ ore?: Item | null }>("/game/loot", { method: "POST", body: { instanceId: id } });
      await onDone(r.ore);
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "Denied"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="loot-pick-back">
      <div className="loot-pick-stack">
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
        {log?.length ? (
          <div className="panel loot-fight-log">
            <div className="section-title">{t("fightLog")}</div>
            <div className="log">
              {log.map((l, i) => (
                <div key={i} className={logTone(l.key)}>
                  {combatLine(l)}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {hover ? <ItemTooltip item={hover.item} x={hover.x} y={hover.y} charLevel={charLevel} /> : null}
    </div>
  );
}
