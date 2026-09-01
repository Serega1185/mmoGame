import { useState } from "react";
import { createPortal } from "react-dom";
import { api } from "./api";
import { useI18n } from "./i18n";

export type TalentLane = "left" | "center" | "center_l" | "center_m" | "center_r" | "right";

export type TalentNodeView = {
  id: string;
  lane: TalentLane;
  tier: number;
  icon: string;
  effect?: string;
  stats?: Record<string, number>;
  names: Record<string, string>;
  descs: Record<string, string>;
};

export type TalentTreeData = {
  taken: string[];
  nodes: TalentNodeView[];
};

export const TREE_SLOTS: { lane: TalentLane; tier: number }[] = [
  { lane: "left", tier: 0 },
  { lane: "left", tier: 1 },
  { lane: "left", tier: 2 },
  { lane: "left", tier: 3 },
  { lane: "center", tier: 0 },
  { lane: "center_l", tier: 1 },
  { lane: "center_l", tier: 2 },
  { lane: "center_l", tier: 3 },
  { lane: "center_m", tier: 1 },
  { lane: "center_m", tier: 2 },
  { lane: "center_m", tier: 3 },
  { lane: "center_r", tier: 1 },
  { lane: "center_r", tier: 2 },
  { lane: "center_r", tier: 3 },
  { lane: "right", tier: 0 },
  { lane: "right", tier: 1 },
  { lane: "right", tier: 2 },
  { lane: "right", tier: 3 },
];

export function slotCol(lane: TalentLane) {
  if (lane === "left") return 1;
  if (lane === "right") return 5;
  if (lane === "center_l") return 2;
  if (lane === "center_r") return 4;
  return 3;
}

export function slotRow(lane: TalentLane, tier: number) {
  return lane === "center" ? 1 : tier + 1;
}

function isRoot(lane: TalentLane) {
  return lane === "left" || lane === "center" || lane === "right";
}

function nodeAt(nodes: TalentNodeView[], lane: TalentLane, tier: number) {
  return nodes.find((n) => n.lane === lane && n.tier === tier) || null;
}

export function treeCommit(tree: TalentTreeData): TalentLane | null {
  const have = new Set(tree.taken);
  const root = tree.nodes.find((n) => n.tier === 0 && isRoot(n.lane) && have.has(n.id));
  return root?.lane || null;
}

export function treeFork(tree: TalentTreeData): TalentLane | null {
  const have = new Set(tree.taken);
  const fork = tree.nodes.find((n) => n.tier === 1 && n.lane.startsWith("center_") && have.has(n.id));
  return fork?.lane || null;
}

export function canTakeNode(tree: TalentTreeData, node: TalentNodeView) {
  if (tree.taken.includes(node.id)) return false;
  const have = new Set(tree.taken);
  const commit = treeCommit(tree);
  if (!commit) return node.tier === 0 && isRoot(node.lane);
  if (commit === "left" || commit === "right") {
    if (node.lane !== commit) return false;
    const prev = nodeAt(tree.nodes, node.lane, node.tier - 1);
    return !!prev && have.has(prev.id);
  }
  if (node.lane === "left" || node.lane === "right" || node.lane === "center") return false;
  const fork = treeFork(tree);
  if (!fork) return node.tier === 1 && node.lane.startsWith("center_");
  if (node.lane !== fork) return false;
  const prev = nodeAt(tree.nodes, node.lane, node.tier - 1);
  return !!prev && have.has(prev.id);
}

function LockMark() {
  return (
    <svg className="talent-lock" viewBox="0 0 24 24" aria-hidden>
      <rect x="7" y="11" width="10" height="8" rx="1.2" fill="#1a120c" stroke="#c4a56a" strokeWidth="1.4" />
      <path d="M9 11 V8.2 C9 6.2 15 6.2 15 8.2 V11" fill="none" stroke="#c4a56a" strokeWidth="1.4" />
    </svg>
  );
}

function Pipes() {
  return (
    <svg className="talent-pipes" viewBox="0 0 282 308" aria-hidden>
      <g stroke="#8a6232" strokeWidth="3" fill="none" strokeLinecap="square">
        <path d="M25 25 V283" />
        <path d="M257 25 V283" />
        <path d="M141 25 V58" />
        <path d="M83 58 H199" />
        <path d="M83 58 V283" />
        <path d="M141 58 V283" />
        <path d="M199 58 V283" />
      </g>
    </svg>
  );
}

export function TalentBoard({
  tree,
  onPick,
  onSlot,
  interactive,
  spendable,
  selected,
}: {
  tree: TalentTreeData;
  onPick?: (id: string) => void;
  onSlot?: (lane: TalentLane, tier: number) => void;
  interactive?: boolean;
  spendable?: boolean;
  selected?: { lane: TalentLane; tier: number } | null;
}) {
  const { lang } = useI18n();
  return (
    <div className="talent-board">
      <Pipes />
      {TREE_SLOTS.map((slot) => {
        const node = nodeAt(tree.nodes, slot.lane, slot.tier);
        const taken = !!(node && tree.taken.includes(node.id));
        const takeable = !!(node && canTakeNode(tree, node));
        const open = !!(takeable && interactive && spendable && !onSlot);
        const locked = !onSlot && !taken && !takeable;
        const sel = selected && selected.lane === slot.lane && selected.tier === slot.tier;
        return (
          <button
            key={`${slot.lane}-${slot.tier}`}
            type="button"
            data-lane={slot.lane}
            data-tier={slot.tier}
            className={`talent-node col-${slotCol(slot.lane)} row-${slotRow(slot.lane, slot.tier)}${taken ? " taken" : ""}${open ? " open" : ""}${locked ? " locked" : ""}${node ? "" : " empty"}${sel ? " selected" : ""}`}
            onClick={() => {
              if (onSlot) onSlot(slot.lane, slot.tier);
              else if (open && node) onPick?.(node.id);
            }}
            data-name={node?.names[lang] || node?.names.en || ""}
          >
            {node?.icon ? <img src={node.icon} alt="" /> : null}
            {locked && node ? <LockMark /> : null}
          </button>
        );
      })}
    </div>
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
  const { t, te, lang } = useI18n();
  const [hover, setHover] = useState<{ node: TalentNodeView; kind: string; x: number; y: number } | null>(null);
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

  function kindFor(node: TalentNodeView) {
    if (tree.taken.includes(node.id)) return "taken";
    if (canTakeNode(tree, node) && points > 0 && !busy) return "ready";
    if (canTakeNode(tree, node)) return "needPoint";
    return "needLine";
  }

  return (
    <div className="talent-wrap">
      <div className="section-title">{t("talents")}</div>
      <p className="muted talent-hint">{points > 0 ? t("talentPoints", { n: points }) : t("talentNeedBoss")}</p>
      <div
        className="talent-tree"
        onMouseMove={(e) => {
          const btn = (e.target as HTMLElement).closest("button.talent-node");
          if (!(btn instanceof HTMLButtonElement)) return;
          const lane = btn.dataset.lane as TalentLane | undefined;
          const tier = Number(btn.dataset.tier);
          if (!lane) return;
          const node = nodeAt(tree.nodes, lane, tier);
          if (!node) {
            setHover(null);
            return;
          }
          setHover({ node, kind: kindFor(node), x: e.clientX, y: e.clientY });
        }}
        onMouseLeave={() => setHover(null)}
      >
        <TalentBoard
          tree={tree}
          interactive={!busy}
          spendable={points > 0}
          onPick={(id) => {
            const node = tree.nodes.find((n) => n.id === id);
            if (node && canTakeNode(tree, node) && points > 0) void pick(id);
          }}
        />
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
              <strong>{hover.node.names[lang] || hover.node.names.en || hover.node.id}</strong>
              <div className="talent-tip-desc">{hover.node.descs[lang] || hover.node.descs.en || ""}</div>
              <div className="muted talent-tip-status">
                {hover.kind === "taken"
                  ? t("talentTipTaken")
                  : hover.kind === "ready"
                    ? t("talentTipReady")
                    : hover.kind === "needPoint"
                      ? t("talentTipNeedPoint")
                      : t("talentTipNeedLine")}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
