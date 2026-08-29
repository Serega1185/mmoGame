import { useState } from "react";
import { createPortal } from "react-dom";
import { api } from "./api";
import { useI18n } from "./i18n";

export type TalentTreeData = {
  rows: string[][];
  revealed: number;
  taken: string[];
};

function Glyph({ id }: { id: string }) {
  const s = "#e8dcc0";
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={s} strokeWidth="1.6" aria-hidden>
      {id === "bloodlust" ? <path d="M12 21 C7 16 4 12 4 8 C4 5 6 3 9 3 C11 3 12 5 12 5 C12 5 13 3 15 3 C18 3 20 5 20 8 C20 12 17 16 12 21 Z" /> : null}
      {id === "finisher" ? <path d="M5 19 L19 5 M15 5 H19 V9 M7 17 L4 20" /> : null}
      {id === "berserk" ? <path d="M12 3 L14 9 H20 L15 13 L17 20 L12 16 L7 20 L9 13 L4 9 H10 Z" /> : null}
      {id === "iron_skin" ? <path d="M12 3 L20 6 V12 C20 17 12 21 12 21 C12 21 4 17 4 12 V6 Z" /> : null}
      {id === "veteran" ? <path d="M8 6 L12 4 L16 6 L19 10 V20 H5 V10 Z" /> : null}
      {id === "butcher" ? <path d="M14 3 L18 7 L10 18 L7 19 L8 16 Z M6 20 H18" /> : null}
      {id === "poisoner" ? <path d="M10 4 H14 V8 L17 18 H7 L10 8 Z M12 11 V15" /> : null}
      {id === "lucky" ? <path d="M12 3 L14 9 H20 L15 13 L17 20 L12 16 L7 20 L9 13 L4 9 H10 Z" /> : null}
      {id === "heavy_hand" ? <path d="M12 8 L12 21 M7 8 H17 V12 H7 Z" /> : null}
      {id === "iron_will" ? <path d="M12 3 L20 6 V12 C20 17 12 21 12 21 C12 21 4 17 4 12 V6 Z M9 12 H15" /> : null}
      {id === "spiked_armor" ? <path d="M12 3 L20 6 V12 C20 17 12 21 12 21 C12 21 4 17 4 12 V6 Z M12 8 V14 M9 11 L15 11" /> : null}
      {id === "last_bastion" ? <path d="M4 12 H20 M12 4 V16 M8 8 H16" /> : null}
      {id === "bleeder" ? <path d="M12 3 L12 14 M8 8 C8 4 16 4 16 10" /> : null}
      {id === "venom_weapon" ? <path d="M14 3 L18 7 L10 18 L7 19 L8 16 Z M9 14 L6 18" /> : null}
      {id === "arcane_might" ? <path d="M12 22 L12 6 M12 6 C16 6 16 2 12 2 C8 2 8 6 12 6" /> : null}
      {id === "?" ? <path d="M9 8 C9 6 11 5 12 5 C14 5 15 7 15 8 C15 10 12 10 12 13 M12 17 V18" /> : null}
      {id === "lock" ? <><rect x="7" y="11" width="10" height="8" rx="1" /><path d="M9 11 V8 C9 5.5 15 5.5 15 8 V11" /></> : null}
    </svg>
  );
}

export function TalentTree({
  tree,
  points,
  reload,
  setErr,
}: {
  tree: TalentTreeData;
  points: number;
  reload: () => Promise<void>;
  setErr: (s: string) => void;
}) {
  const { t, te, skillName, skillDesc } = useI18n();
  const [hover, setHover] = useState<{ id: string; kind: string; x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(id: string) {
    if (busy || points < 1) return;
    setBusy(true);
    try {
      await api("/game/talent", { method: "POST", body: { talentId: id } });
      await reload();
      setErr("");
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "Denied"));
    } finally {
      setBusy(false);
    }
  }

  function canTake(row: number, id: string) {
    if (points < 1 || tree.taken.includes(id) || busy) return false;
    if (row >= tree.revealed) return false;
    if (tree.taken.length === 0) return row === 0;
    if (tree.taken.length === 1) return row === 1;
    return true;
  }

  function tipKind(row: number, id: string, hidden: boolean, taken: boolean, open: boolean) {
    if (hidden && row === tree.revealed) return "hidden";
    if (hidden) return "locked";
    if (taken) return "taken";
    if (open) return "ready";
    if (points < 1) return "needPoint";
    return "needRow";
  }

  return (
    <div className="talent-wrap">
      <div className="section-title">{t("talents")}</div>
      <p className="muted talent-hint">
        {points > 0 ? t("talentPoints", { n: points }) : t("talentNeedBoss")}
      </p>
      <div className="talent-tree">
        <div className="talent-spine" />
        {[0, 1, 2].map((row) => {
          const hidden = row >= tree.revealed;
          const ids = hidden ? ["?", "?", "?"] : tree.rows[row] || [];
          return (
            <div key={row} className={`talent-row ${hidden ? "locked" : ""}`}>
              <div className="talent-ring" />
              {(ids.length ? ids : ["?", "?", "?"]).slice(0, 3).map((id, i) => {
                const taken = !hidden && tree.taken.includes(id);
                const open = !hidden && canTake(row, id);
                const mark = hidden ? (row === tree.revealed ? "?" : "lock") : id;
                const kind = tipKind(row, id, hidden, taken, open);
                return (
                  <button
                    key={`${row}-${i}`}
                    type="button"
                    className={`talent-node ${taken ? "taken" : ""} ${open ? "open" : ""} ${hidden ? "fog" : ""}`}
                    onClick={() => open && pick(id)}
                    onMouseEnter={(e) => setHover({ id: hidden ? mark : id, kind, x: e.clientX, y: e.clientY })}
                    onMouseMove={(e) => setHover((h) => (h ? { ...h, id: hidden ? mark : id, kind, x: e.clientX, y: e.clientY } : h))}
                    onMouseLeave={() => setHover(null)}
                  >
                    <Glyph id={mark} />
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      {hover
        ? createPortal(
            <div
              className="tooltip parchment talent-tip"
              style={{
                left: Math.min(hover.x + 14, window.innerWidth - 300),
                top: Math.min(hover.y + 14, window.innerHeight - 200),
              }}
            >
              {hover.kind === "hidden" || hover.kind === "locked" ? (
                <>
                  <strong>{hover.kind === "hidden" ? "?" : t("talents")}</strong>
                  <div>{t(hover.kind === "hidden" ? "talentTipHidden" : "talentTipLocked")}</div>
                </>
              ) : (
                <>
                  <strong>{skillName(hover.id, hover.id)}</strong>
                  <div className="talent-tip-desc">{skillDesc(hover.id)}</div>
                  <div className="muted talent-tip-status">
                    {hover.kind === "taken"
                      ? t("talentTipTaken")
                      : hover.kind === "ready"
                        ? t("talentTipReady")
                        : hover.kind === "needPoint"
                          ? t("talentTipNeedPoint")
                          : t("talentTipNeedRow")}
                  </div>
                </>
              )}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
