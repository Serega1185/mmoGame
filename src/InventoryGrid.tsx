import { useEffect, useMemo, useState } from "react";
import type { Item } from "./api";
import { ItemFace, ItemTooltip } from "./ui";

type Props = {
  cols: number;
  rows: number;
  items: Item[];
  dest: "INVENTORY" | "STORAGE";
  cell?: number;
  charLevel?: number;
  onPlace: (id: string, x: number, y: number, rotated: number) => void;
  onCtrlClick: (item: Item) => void;
  onEquip?: (item: Item) => void;
  onContext?: (item: Item) => void;
  onPick?: (item: Item) => void;
};

export function InventoryGrid({ cols, rows, items, dest, cell = 70, charLevel, onPlace, onCtrlClick, onEquip, onContext, onPick }: Props) {
  const [hover, setHover] = useState<{ item: Item; x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [lit, setLit] = useState<number | null>(null);

  useEffect(() => {
    setHover((h) => (h && items.some((it) => it.id === h.item.id) ? h : null));
    setSelected((id) => (id && items.some((it) => it.id === id) ? id : null));
  }, [items]);

  const occupied = useMemo(() => {
    const g: (string | null)[][] = Array.from({ length: rows }, () => Array(cols).fill(null));
    for (const it of items) {
      if (it.grid_x == null || it.grid_y == null) continue;
      if (g[it.grid_y]) g[it.grid_y]![it.grid_x] = it.id;
    }
    return g;
  }, [items, cols, rows]);

  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: `repeat(${cols}, ${cell}px)`, gridTemplateRows: `repeat(${rows}, ${cell}px)` }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData("text/item") || drag;
        if (!id) return;
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left - 6) / (cell + 2));
        const y = Math.floor((e.clientY - rect.top - 6) / (cell + 2));
        onPlace(id, x, y, 0);
        setDrag(null);
      }}
    >
      {Array.from({ length: rows * cols }, (_, i) => {
        const x = i % cols;
        const y = Math.floor(i / cols);
        const occ = occupied[y]?.[x];
        const origin = items.find((it) => it.id === occ && it.grid_x === x && it.grid_y === y);
        return (
          <div
            key={i}
            className={`cell ${origin ? `has-item r-${origin.rarity}` : ""} ${lit === i || selected === origin?.id ? "lit" : ""}`}
            onMouseEnter={() => setLit(i)}
            onMouseLeave={() => setLit(null)}
          >
            {origin ? (
              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/item", origin.id);
                  e.dataTransfer.setData("text/dest", dest);
                  setDrag(origin.id);
                  setHover(null);
                }}
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    onCtrlClick(origin);
                    return;
                  }
                  setSelected(origin.id);
                  setHover(null);
                  onPick?.(origin);
                }}
                onDoubleClick={() => {
                  setHover(null);
                  onEquip?.(origin);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setHover(null);
                  onContext?.(origin);
                }}
                onMouseEnter={(e) => setHover({ item: origin, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => setHover({ item: origin, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHover(null)}
                style={{ position: "absolute", inset: 0, zIndex: 3 }}
              >
                <ItemFace item={origin} />
              </div>
            ) : null}
          </div>
        );
      })}
      {hover ? <ItemTooltip item={hover.item} x={hover.x} y={hover.y} charLevel={charLevel} /> : null}
    </div>
  );
}
