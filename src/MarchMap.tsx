import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useI18n } from "./i18n";

export type MarchNodeView = {
  id: string;
  floor: number;
  col: number;
  kind: string;
  next: string[];
};

export type MarchView = {
  nodes: MarchNodeView[];
  current: string | null;
  pending: string | null;
  visited: string[];
  reachable: string[];
};

const W = 360;
const H = 740;
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 2.4;

function pos(n: MarchNodeView) {
  const x = n.floor === 5 || n.floor === 10 ? W / 2 : 48 + n.col * 132;
  const y = 40 + (10 - n.floor) * 68;
  return { x, y };
}

function NodeIcon({ kind }: { kind: string }) {
  const props = { className: "map-glyph" + (kind === "boss" ? " map-glyph-boss" : kind === "loot" ? " map-glyph-loot" : ""), textAnchor: "middle" as const, dominantBaseline: "central" as const };
  if (kind === "mystery") return <text {...props}>?</text>;
  if (kind === "city") return <text {...props}>⌂</text>;
  if (kind === "boss") return <text {...props}>☠</text>;
  if (kind === "elite") return <text {...props}>♛</text>;
  if (kind === "loot") return <text {...props}>◆</text>;
  return <text {...props}>⚔</text>;
}

export function MarchMap({
  march,
  interactive,
  onPick,
}: {
  march: MarchView;
  interactive: boolean;
  onPick: (id: string) => void;
}) {
  const { t } = useI18n();
  const byId = new Map(march.nodes.map((n) => [n.id, n]));
  const panBox = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; sl: number; st: number; moved: boolean } | null>(null);
  const panned = useRef(false);
  const scaleRef = useRef(1);
  const [scale, setScale] = useState(1);
  const [tip, setTip] = useState<{ kind: string; x: number; y: number } | null>(null);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    const el = panBox.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const old = scaleRef.current;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, old * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      if (next === old) return;
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left + el.scrollLeft;
      const my = e.clientY - rect.top + el.scrollTop;
      const ratio = next / old;
      scaleRef.current = next;
      setScale(next);
      requestAnimationFrame(() => {
        el.scrollLeft = mx * ratio - (e.clientX - rect.left);
        el.scrollTop = my * ratio - (e.clientY - rect.top);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function onPanDown(e: MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const el = panBox.current;
    if (!el) return;
    panned.current = false;
    drag.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop, moved: false };
    el.classList.add("panning");
    e.preventDefault();
    const move = (ev: globalThis.MouseEvent) => {
      if (!drag.current || !panBox.current) return;
      const dx = ev.clientX - drag.current.x;
      const dy = ev.clientY - drag.current.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        drag.current.moved = true;
        panned.current = true;
      }
      panBox.current.scrollLeft = drag.current.sl - dx;
      panBox.current.scrollTop = drag.current.st - dy;
    };
    const up = () => {
      panBox.current?.classList.remove("panning");
      drag.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  return (
    <div className="march-map">
      <div className="section-title">{t("mapTitle")}</div>
      <p className="muted map-hint">{t("mapHint")}</p>
      <div className="march-pan" ref={panBox} onMouseDown={onPanDown}>
        <svg className="march-svg" viewBox={`0 0 ${W} ${H}`} role="img" style={{ width: W * scale, height: H * scale }}>
          {march.nodes.flatMap((n) =>
            n.next.map((nid) => {
              const b = byId.get(nid);
              if (!b) return null;
              const a = pos(n);
              const p = pos(b);
              return (
                <line
                  key={`${n.id}-${nid}`}
                  x1={a.x}
                  y1={a.y}
                  x2={p.x}
                  y2={p.y}
                  className="map-path"
                />
              );
            })
          )}
          {march.nodes.map((n) => {
            const p = pos(n);
            const reach = march.reachable.includes(n.id);
            const here = march.current === n.id || march.pending === n.id;
            const seen = march.visited.includes(n.id);
            return (
              <g
                key={n.id}
                transform={`translate(${p.x}, ${p.y})`}
                className={`map-node k-${n.kind} ${reach ? "reach" : ""} ${here ? "here" : ""} ${seen ? "seen" : ""}`}
                onClick={() => {
                  if (panned.current) return;
                  if (interactive && reach) onPick(n.id);
                }}
                onMouseEnter={(e) => setTip({ kind: n.kind, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => setTip((cur) => (cur ? { ...cur, x: e.clientX, y: e.clientY } : { kind: n.kind, x: e.clientX, y: e.clientY }))}
                onMouseLeave={() => setTip(null)}
                style={{ cursor: interactive && reach ? "pointer" : "default" }}
              >
                <circle r={here ? 22 : 18} className="map-ring" />
                <circle r={16} className="map-disk" />
                <NodeIcon kind={n.kind} />
              </g>
            );
          })}
        </svg>
      </div>
      {tip ? (
        <div
          className="tooltip parchment tip-short map-node-tip"
          style={{ left: Math.min(tip.x + 14, window.innerWidth - 260), top: Math.min(tip.y + 14, window.innerHeight - 90) }}
        >
          <strong>{t(`node_${tip.kind}` as "node_monster")}</strong>
          <div className="muted">{t(`nodeTip_${tip.kind}` as "nodeTip_monster")}</div>
        </div>
      ) : null}
    </div>
  );
}
