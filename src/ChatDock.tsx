import { useEffect, useRef, useState, type MouseEvent } from "react";
import { api, type Item } from "./api";
import { ItemTooltip } from "./ui";
import { useI18n } from "./i18n";

const RARITIES = new Set(["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"]);
const LINK_MD = /\[(.*?)\]\(ITEM_LINK:([a-f0-9-]+)(?::([A-Za-z]+))?\)/;
const LINK_BARE = /ITEM_LINK:([a-f0-9-]+)(?::([A-Za-z]+))?/;

type Msg = {
  id: string;
  channel: string;
  username: string;
  user_id: string;
  body: string;
  created_at: number;
  to?: string;
};

function cleanRarity(raw?: string) {
  return raw && RARITIES.has(raw) ? raw : "";
}

function linkIds(body: string) {
  return [...body.matchAll(/ITEM_LINK:([a-f0-9-]+)/g)].map((m) => m[1]);
}

function parseBody(
  body: string,
  onEnter: (id: string, x: number, y: number) => void,
  onMove: (x: number, y: number) => void,
  onLeave: () => void,
  linkedLabel: string,
  rarityOf: (id: string) => string
) {
  const parts = body.split(/(\[.*?\]\(ITEM_LINK:[a-f0-9-]+(?::[A-Za-z]+)?\)|ITEM_LINK:[a-f0-9-]+(?::[A-Za-z]+)?)/g);
  return parts.map((p, i) => {
    const md = p.match(LINK_MD);
    const bare = md ? null : p.match(LINK_BARE);
    const m = md || bare;
    if (m) {
      const id = md ? m[2] : m[1];
      const label = md ? m[1] : linkedLabel;
      const tagged = cleanRarity(md ? m[3] : m[2]);
      const rarity = rarityOf(id) || tagged;
      return (
        <span
          key={i}
          className={`item-link${rarity ? ` rarity-${rarity}` : ""}`}
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
  const [linkRarity, setLinkRarity] = useState<Record<string, string>>({});
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

  useEffect(() => {
    const ids = [...new Set(msgs.flatMap((m) => linkIds(m.body)))];
    let cancelled = false;
    void Promise.all(
      ids.map(async (id) => {
        if (cache.current.has(id)) {
          const r = cache.current.get(id)!.rarity;
          if (!cancelled && r) setLinkRarity((prev) => (prev[id] === r ? prev : { ...prev, [id]: r }));
          return;
        }
        try {
          const d = await api<{ item: Item }>(`/items/${id}`);
          cache.current.set(id, d.item);
          if (!cancelled && d.item.rarity) {
            setLinkRarity((prev) => (prev[id] === d.item.rarity ? prev : { ...prev, [id]: d.item.rarity }));
          }
        } catch {
          /* gone */
        }
      })
    );
    return () => {
      cancelled = true;
    };
  }, [msgs]);

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
      setLinkRarity((prev) => ({ ...prev, [id]: d.item.rarity }));
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
        <button type="button" className="chat-float-toggle" onClick={() => setCollapsed((c) => !c)}>
          {open ? "▾" : "▴"}
        </button>
      </div>
      {open ? (
        <div className="chat">
          <div className="chat-chans">
            {(["GLOBAL", "GUILD", "PRIVATE"] as const).map((c) => (
              <button
                key={c}
                type="button"
                className={channel === c ? "gold" : ""}
                disabled={c === "GUILD" && !canGuild}
                onClick={() => setChannel(c)}
              >
                {t(`chan${c}`)}
              </button>
            ))}
          </div>
          {channel === "PRIVATE" ? (
            <select className="chat-whisper" value={privTo} onChange={(e) => setPrivTo(e.target.value)}>
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
                <div key={m.id} className="chat-line">
                  <span className="chat-time">{new Date(m.created_at).toLocaleTimeString()}</span>{" "}
                  <span className="chat-chan">[{t(`chan${m.channel === "REGION" ? "GLOBAL" : m.channel}`)}]</span>{" "}
                  <span className="chat-nick">{m.username}</span>
                  {": "}
                  <span className="chat-body">
                    {parseBody(
                      m.body,
                      hoverLink,
                      (x, y) => {
                        setPreview((p) => (p ? { ...p, x, y } : p));
                        setHint((h) => (h ? { ...h, x, y } : h));
                      },
                      leaveLink,
                      t("linkedItem"),
                      (id) => linkRarity[id] || ""
                    )}
                  </span>
                </div>
              ))}
          </div>
          <div className="chat-compose">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder={t("speakPh")}
            />
            <button type="button" className="gold" onClick={send}>
              {t("speak")}
            </button>
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
