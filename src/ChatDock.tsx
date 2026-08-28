import { useEffect, useRef, useState } from "react";
import { api, type Item } from "./api";
import { ItemTooltip } from "./ui";

type Msg = {
  id: string;
  channel: string;
  username: string;
  user_id: string;
  body: string;
  created_at: number;
  to?: string;
};

function parseBody(body: string, onLink: (id: string) => void) {
  const parts = body.split(/(\[.*?\]\(ITEM_LINK:[a-f0-9-]+\)|ITEM_LINK:[a-f0-9-]+)/g);
  return parts.map((p, i) => {
    const m = p.match(/\[(.*?)\]\(ITEM_LINK:([a-f0-9-]+)\)/) || p.match(/ITEM_LINK:([a-f0-9-]+)/);
    if (m) {
      const id = m[2] || m[1];
      const label = m[2] ? m[1] : "Linked Item";
      return (
        <span key={i} className="item-link" onClick={() => onLink(id!)}>
          [{label}]
        </span>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

export function ChatDock({
  ws,
  username,
  canGuild,
  region,
  linkQueue,
  onConsumedLink,
}: {
  ws: WebSocket | null;
  username: string;
  canGuild: boolean;
  region: number;
  linkQueue: string | null;
  onConsumedLink: () => void;
}) {
  const [channel, setChannel] = useState<"GLOBAL" | "REGION" | "GUILD" | "PRIVATE">("GLOBAL");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Item | null>(null);
  const [err, setErr] = useState("");
  const [privTo, setPrivTo] = useState("");
  const [players, setPlayers] = useState<{ id: string; username: string }[]>([]);
  const box = useRef<HTMLDivElement>(null);

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
  }, [msgs]);

  useEffect(() => {
    if (linkQueue) {
      setText((t) => (t ? t + " " : "") + linkQueue);
      onConsumedLink();
    }
  }, [linkQueue, onConsumedLink]);

  function send() {
    if (!ws || ws.readyState !== 1 || !text.trim()) return;
    ws.send(JSON.stringify({ type: "chat", channel, body: text, to: privTo || undefined }));
    setText("");
  }

  async function openLink(id: string) {
    try {
      const d = await api<{ item: Item }>(`/items/${id}`);
      setPreview(d.item);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Item no longer exists.");
      setPreview(null);
    }
  }

  return (
    <div className="panel chat" style={{ padding: "0.7rem" }}>
      <div className="section-title">The Crier's Hall</div>
      <div className="row" style={{ marginBottom: 6 }}>
        {(["GLOBAL", "REGION", "GUILD", "PRIVATE"] as const).map((c) => (
          <button key={c} disabled={c === "GUILD" && !canGuild} onClick={() => setChannel(c)} style={{ opacity: channel === c ? 1 : 0.7 }}>
            {c}
          </button>
        ))}
      </div>
      {channel === "PRIVATE" ? (
        <select value={privTo} onChange={(e) => setPrivTo(e.target.value)} style={{ marginBottom: 6 }}>
          <option value="">Choose a soul…</option>
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
              <span className="chan">[{m.channel}]</span> {m.username}: {parseBody(m.body, openLink)}
            </div>
          ))}
      </div>
      {err ? <div className="error">{err}</div> : null}
      <div className="row" style={{ marginTop: 6 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Speak, or Ctrl+click an item to seal it…"
        />
        <button onClick={send}>Speak</button>
      </div>
      <p className="muted">Ctrl + click an item to bind a true seal (ITEM_LINK). Fake boasts are refused.</p>
      {preview ? <ItemTooltip item={preview} x={window.innerWidth / 2 - 80} y={120} /> : null}
      {preview ? (
        <button style={{ marginTop: 6 }} onClick={() => setPreview(null)}>
          Close seal
        </button>
      ) : null}
    </div>
  );
}
