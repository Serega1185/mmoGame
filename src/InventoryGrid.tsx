import { useMemo, useState } from "react";
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
};

export function InventoryGrid({ cols, rows, items, dest, cell = 44, charLevel, onPlace, onCtrlClick, onEquip, onContext }: Props) {
  const [hover, setHover] = useState<{ item: Item; x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<string | null>(null);

  const occupied = useMemo(() => {
    const g: (string | null)[][] = Array.from({ length: rows }, () => Array(cols).fill(null));
    for (const it of items) {
      if (it.grid_x == null || it.grid_y == null) continue;
      const w = it.rotated ? it.height : it.width;
      const h = it.rotated ? it.width : it.height;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (g[it.grid_y + y]) g[it.grid_y + y]![it.grid_x + x] = it.id;
      }
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
        const it = items.find((i) => i.id === id);
        onPlace(id, x, y, it?.rotated || 0);
        setDrag(null);
      }}
    >
      {Array.from({ length: rows * cols }, (_, i) => {
        const x = i % cols;
        const y = Math.floor(i / cols);
        const occ = occupied[y]?.[x];
        const origin = items.find((it) => it.id === occ && it.grid_x === x && it.grid_y === y);
        return (
          <div key={i} className="cell">
            {origin ? (
              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/item", origin.id);
                  e.dataTransfer.setData("text/dest", dest);
                  setDrag(origin.id);
                }}
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    onCtrlClick(origin);
                  }
                }}
                onDoubleClick={() => onEquip?.(origin)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onContext?.(origin);
                }}
                onMouseEnter={(e) => setHover({ item: origin, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => setHover({ item: origin, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHover(null)}
                style={{
                  position: "absolute",
                  width: (origin.rotated ? origin.height : origin.width) * (cell + 2) - 2,
                  height: (origin.rotated ? origin.width : origin.height) * (cell + 2) - 2,
                  zIndex: 3,
                }}
              >
                <ItemFace
                  item={origin}
                  w={(origin.rotated ? origin.height : origin.width) * (cell + 2) - 4}
                  h={(origin.rotated ? origin.width : origin.height) * (cell + 2) - 4}
                />
              </div>
            ) : null}
          </div>
        );
      })}
      {hover ? <ItemTooltip item={hover.item} x={hover.x} y={hover.y} charLevel={charLevel} /> : null}
    </div>
  );
}
