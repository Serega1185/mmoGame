import { useEffect, useRef, useState, type MouseEvent } from "react";
import { api, type Item } from "./api";
import { ItemTooltip } from "./ui";
import { useI18n } from "./i18n";

type Msg = {
  id: string;
  channel: string;
  username: string;
  user_id: string;
  body: string;
  created_at: number;
  to?: string;
};

function parseBody(
  body: string,
  onEnter: (id: string, x: number, y: number) => void,
  onMove: (x: number, y: number) => void,
  onLeave: () => void,
  linkedLabel: string
) {
  const parts = body.split(/(\[.*?\]\(ITEM_LINK:[a-f0-9-]+\)|ITEM_LINK:[a-f0-9-]+)/g);
  return parts.map((p, i) => {
    const m = p.match(/\[(.*?)\]\(ITEM_LINK:([a-f0-9-]+)\)/) || p.match(/ITEM_LINK:([a-f0-9-]+)/);
    if (m) {
      const id = m[2] || m[1];
      const label = m[2] ? m[1] : linkedLabel;
      return (
        <span
          key={i}
          className="item-link"
          onMouseEnter={(e) => onEnter(id!, e.clientX, e.clientY)}
          onMouseMove={(e) => onMove(e.clientX, e.clientY)}
          onMouseLeave={onLeave}
        >
          [{label}]
        </span>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

type Chan = "GLOBAL" | "GUILD" | "PRIVATE";

export function ChatDock({
  ws,
  username,
  canGuild,
  region,
  linkQueue,
  onConsumedLink,
  forceOpen,
}: {
  ws: WebSocket | null;
  username: string;
  canGuild: boolean;
  region: number;
  linkQueue: string | null;
  onConsumedLink: () => void;
  forceOpen?: boolean;
}) {
  const { t } = useI18n();
  const [channel, setChannel] = useState<Chan>("GLOBAL");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ item: Item; x: number; y: number } | null>(null);
  const [hint, setHint] = useState<{ text: string; x: number; y: number } | null>(null);
  const [privTo, setPrivTo] = useState("");
  const [players, setPlayers] = useState<{ id: string; username: string }[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<string, Item>());
  const hoverId = useRef<string | null>(null);
  const drag = useRef<{ mx: number; my: number; x: number; y: number } | null>(null);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("ash.chat.col") === "1");
  const [pos, setPos] = useState(() => {
    try {
      const raw = localStorage.getItem("ash.chat.pos");
      if (raw) return JSON.parse(raw) as { x: number; y: number };
    } catch {
      /* ignore */
    }
    return { x: 16, y: 16 };
  });

  const open = forceOpen || !collapsed;

  useEffect(() => {
    localStorage.setItem("ash.chat.col", collapsed ? "1" : "0");
  }, [collapsed]);
  useEffect(() => {
    localStorage.setItem("ash.chat.pos", JSON.stringify(pos));
  }, [pos]);

  useEffect(() => {
    api<{ players: { id: string; username: string }[] }>("/players").then((d) => setPlayers(d.players)).catch(() => {});
  }, []);

  useEffect(() => {
    if (channel === "PRIVATE") return;
    api<{ messages: Msg[] }>(`/chat?channel=${channel}`).then((d) => setMsgs(d.messages as Msg[])).catch(() => {});
  }, [channel, region]);

  useEffect(() => {
    if (!ws) return;
    const onMsg = (ev: MessageEvent) => {
      const m = JSON.parse(ev.data);
      if (m.type === "chat") {
        setMsgs((prev) => [...prev.slice(-100), m]);
      }
    };
    ws.addEventListener("message", onMsg);
    return () => ws.removeEventListener("message", onMsg);
  }, [ws]);

  useEffect(() => {
    box.current?.scrollTo(0, 99999);
  }, [msgs, open]);

  useEffect(() => {
    if (linkQueue) {
      setText((cur) => (cur ? cur + " " : "") + linkQueue);
      onConsumedLink();
      setCollapsed(false);
    }
  }, [linkQueue, onConsumedLink]);

  function send() {
    if (!ws || ws.readyState !== 1 || !text.trim()) return;
    ws.send(JSON.stringify({ type: "chat", channel, body: text, to: privTo || undefined }));
    setText("");
  }

  async function hoverLink(id: string, x: number, y: number) {
    hoverId.current = id;
    const cached = cache.current.get(id);
    if (cached) {
      setPreview({ item: cached, x, y });
      setHint(null);
      return;
    }
    try {
      const d = await api<{ item: Item }>(`/items/${id}`);
      cache.current.set(id, d.item);
      if (hoverId.current === id) {
        setPreview({ item: d.item, x, y });
        setHint(null);
      }
    } catch {
      if (hoverId.current === id) {
        setPreview(null);
        setHint({ text: t("itemGone"), x, y });
      }
    }
  }

  function leaveLink() {
    hoverId.current = null;
    setPreview(null);
    setHint(null);
  }

  function onDragStart(e: MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { mx: e.clientX, my: e.clientY, x: pos.x, y: pos.y };
    const move = (ev: globalThis.MouseEvent) => {
      if (!drag.current) return;
      setPos({
        x: Math.max(8, Math.min(window.innerWidth - 280, drag.current.x + ev.clientX - drag.current.mx)),
        y: Math.max(8, Math.min(window.innerHeight - 48, drag.current.y - (ev.clientY - drag.current.my))),
      });
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  return (
    <div className={`chat-float panel ${open ? "open" : "closed"}`} style={{ left: pos.x, bottom: pos.y }}>
      <div className="chat-float-bar" onMouseDown={onDragStart}>
        <span className="chat-float-title">{t("chatTitle")}</span>
        <button type="button" onClick={() => setCollapsed((c) => !c)}>
          {open ? "▾" : "▴"}
        </button>
      </div>
      {open ? (
        <div className="chat" style={{ padding: "0 0.7rem 0.7rem" }}>
          <div className="row" style={{ marginBottom: 6 }}>
            {(["GLOBAL", "GUILD", "PRIVATE"] as const).map((c) => (
              <button key={c} disabled={c === "GUILD" && !canGuild} onClick={() => setChannel(c)} style={{ opacity: channel === c ? 1 : 0.7 }}>
                {t(`chan${c}`)}
              </button>
            ))}
          </div>
          {channel === "PRIVATE" ? (
            <select value={privTo} onChange={(e) => setPrivTo(e.target.value)} style={{ marginBottom: 6 }}>
              <option value="">{t("chooseSoul")}</option>
              {players.filter((p) => p.username !== username).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.username}
                </option>
              ))}
            </select>
          ) : null}
          <div className="chat-msgs" ref={box}>
            {msgs
              .filter((m) => (channel === "PRIVATE" ? m.channel === "PRIVATE" : m.channel === channel || !m.channel))
              .map((m) => (
                <div key={m.id}>
                  <span className="muted">{new Date(m.created_at).toLocaleTimeString()}</span>{" "}
                  <span className="chan">[{t(`chan${m.channel === "REGION" ? "GLOBAL" : m.channel}`)}]</span> {m.username}:{" "}
                  {parseBody(
                    m.body,
                    hoverLink,
                    (x, y) => {
                      setPreview((p) => (p ? { ...p, x, y } : p));
                      setHint((h) => (h ? { ...h, x, y } : h));
                    },
                    leaveLink,
                    t("linkedItem")
                  )}
                </div>
              ))}
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder={t("speakPh")}
            />
            <button onClick={send}>{t("speak")}</button>
          </div>
        </div>
      ) : null}
      {preview ? <ItemTooltip item={preview.item} x={preview.x} y={preview.y} /> : null}
      {hint ? (
        <div
          className="tooltip parchment tip-short"
          style={{ left: Math.min(hint.x + 12, window.innerWidth - 220), top: Math.min(hint.y + 12, window.innerHeight - 64) }}
        >
          {hint.text}
        </div>
      ) : null}
    </div>
  );
}
