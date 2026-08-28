import { useCallback, useEffect, useState } from "react";
import { api, SLOTS, STAT_LABEL, PCT, type Item } from "./api";
import { InventoryGrid } from "./InventoryGrid";
import { ChatDock } from "./ChatDock";
import { Glyph, ItemTooltip, fmtStat } from "./ui";

type User = {
  id: string;
  username: string;
  email: string;
  role: string;
  coins: number;
  storage_level: number;
  shop_level: number;
  auction_level: number;
  highest_region: number;
  guild_id: string | null;
};

type Character = {
  id: string;
  name: string;
  class: string;
  level: number;
  xp: number;
  region: number;
  round: number;
  hp: number;
  max_hp: number;
  status: string;
  location: string;
  skill_pending: number;
  enemies_defeated: number;
  gold_earned: number;
  power: { stats: Record<string, number>; maxHp: number; setBonuses: { set: string; pieces: number }[] };
};

type GameState = {
  needCharacter?: boolean;
  user: User;
  character: Character;
  inventory: Item[];
  equipment: Item[];
  ground: Item[];
  skills: { id: string; name: string; description: string }[];
  skillChoices: { id: string; name: string; description: string }[];
  region: { name: string; theme: string; description: string };
  grid: { cols: number; rows: number };
  storage: null | { items: Item[]; cols: number; rows: number; cells: number; level: number; upgradeCost: number };
};

type Fight = {
  won: boolean;
  dead?: boolean;
  enemy: { name: string; kind: string; hp: number };
  log: { t: number; text: string }[];
  gold?: number;
  loot?: Item[];
  xpGain?: number;
  level?: number;
  death?: Record<string, unknown>;
  playerHp: number;
};

const CLASSES = [
  { id: "Ironclad", blurb: "Thick hide, heavier steel. Armor and endurance." },
  { id: "Shadehand", blurb: "Quiet knives, stolen breaths. Crit, dodge, leech." },
  { id: "Thornbow", blurb: "The hedge keeps its own. Loot, gold, and keen shots." },
];

export default function App() {
  const [boot, setBoot] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [err, setErr] = useState("");
  const [mode, setMode] = useState<"play" | "city" | "storage" | "shop" | "auction" | "guild" | "admin">("play");
  const [mobile, setMobile] = useState<"equip" | "pack" | "fight" | "city" | "chat">("fight");
  const [fight, setFight] = useState<Fight | null>(null);
  const [speed, setSpeed] = useState<1 | 2 | 4 | 0>(1);
  const [logShown, setLogShown] = useState(0);
  const [linkQ, setLinkQ] = useState<string | null>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [ctx, setCtx] = useState<{ item: Item; kind: string } | null>(null);
  const [invQ, setInvQ] = useState("");
  const [invRarity, setInvRarity] = useState("");
  const [auctionPrice, setAuctionPrice] = useState("100");
  const [hours, setHours] = useState<12 | 24>(12);
  const [shop, setShop] = useState<Record<string, unknown> | null>(null);
  const [auction, setAuction] = useState<Record<string, unknown> | null>(null);
  const [guilds, setGuilds] = useState<Record<string, unknown> | null>(null);
  const [myGuild, setMyGuild] = useState<Record<string, unknown> | null>(null);
  const [hoverEq, setHoverEq] = useState<{ item: Item; x: number; y: number } | null>(null);
  const [auth, setAuth] = useState({ email: "", password: "", username: "", tab: "login" as "login" | "register" | "forgot" });
  const [create, setCreate] = useState({ name: "", class: "Ironclad" });
  const [admin, setAdmin] = useState<Record<string, unknown> | null>(null);

  const reload = useCallback(async () => {
    try {
      const me = await api<{ user: User; characters: Character[] }>("/me");
      setUser(me.user);
      const g = await api<GameState>("/game");
      setGame(g.needCharacter ? ({ needCharacter: true, user: me.user } as GameState) : g);
      setErr("");
    } catch {
      setUser(null);
      setGame(null);
    } finally {
      setBoot(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!user) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const sock = new WebSocket(`${proto}://${location.host}/ws`);
    const ping = setInterval(() => sock.readyState === 1 && sock.send(JSON.stringify({ type: "ping" })), 20000);
    setWs(sock);
    return () => {
      clearInterval(ping);
      sock.close();
    };
  }, [user?.id]);

  useEffect(() => {
    if (!fight || fight.dead) return;
    if (speed === 0) {
      setLogShown(fight.log.length);
      return;
    }
    setLogShown(0);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setLogShown(i);
      if (i >= fight.log.length) clearInterval(id);
    }, Math.max(12, 90 / speed));
    return () => clearInterval(id);
  }, [fight, speed]);

  async function linkItem(item: Item) {
    try {
      const d = await api<{ token: string; name: string }>("/items/link", { method: "POST", body: { instanceId: item.id } });
      setLinkQ(`[${d.name}](${d.token})`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Seal failed");
    }
  }

  async function place(id: string, dest: "INVENTORY" | "STORAGE" | "EQUIPMENT" | "DISCARD", extra: Record<string, unknown> = {}) {
    try {
      await api("/items/move", { method: "POST", body: { instanceId: id, dest, ...extra } });
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Cannot move");
    }
  }

  if (boot) {
    return (
      <div className="auth-screen">
        <h1>Ashmarch</h1>
        <p className="brand-sub">The ledger is opening…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="auth-screen">
        <div className="panel auth-card">
          <div style={{ textAlign: "center" }}>
            <span className="torch" />
            <h1>Ashmarch</h1>
            <div className="brand-sub">Tithe of Iron</div>
            <p className="muted">A dark medieval inventory MMO. Everything you carry can die with you. The vault does not.</p>
          </div>
          <div className="row" style={{ justifyContent: "center", margin: "1rem 0" }}>
            <button onClick={() => setAuth((a) => ({ ...a, tab: "login" }))}>Enter</button>
            <button onClick={() => setAuth((a) => ({ ...a, tab: "register" }))}>Enlist</button>
            <button onClick={() => setAuth((a) => ({ ...a, tab: "forgot" }))}>Lost Key</button>
          </div>
          {auth.tab !== "login" ? null : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api("/auth/login", { method: "POST", body: { email: auth.email, password: auth.password } });
                  await reload();
                } catch (er) {
                  setErr(er instanceof Error ? er.message : "Denied");
                }
              }}
            >
              <label>Email</label>
              <input value={auth.email} onChange={(e) => setAuth({ ...auth, email: e.target.value })} />
              <label>Password</label>
              <input type="password" value={auth.password} onChange={(e) => setAuth({ ...auth, password: e.target.value })} />
              <button className="gold" style={{ marginTop: 12, width: "100%" }}>
                Break the seal
              </button>
            </form>
          )}
          {auth.tab === "register" ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api("/auth/register", {
                    method: "POST",
                    body: { email: auth.email, password: auth.password, username: auth.username },
                  });
                  await reload();
                } catch (er) {
                  setErr(er instanceof Error ? er.message : "Denied");
                }
              }}
            >
              <label>Email</label>
              <input value={auth.email} onChange={(e) => setAuth({ ...auth, email: e.target.value })} />
              <label>Password</label>
              <input type="password" value={auth.password} onChange={(e) => setAuth({ ...auth, password: e.target.value })} />
              <label>Username</label>
              <input value={auth.username} onChange={(e) => setAuth({ ...auth, username: e.target.value })} />
              <button className="gold" style={{ marginTop: 12, width: "100%" }}>
                Carve the name
              </button>
            </form>
          ) : null}
          {auth.tab === "forgot" ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const d = await api<{ hint: string }>("/auth/forgot", { method: "POST", body: { email: auth.email } });
                  setErr(d.hint);
                } catch (er) {
                  setErr(er instanceof Error ? er.message : "Denied");
                }
              }}
            >
              <label>Email</label>
              <input value={auth.email} onChange={(e) => setAuth({ ...auth, email: e.target.value })} />
              <button style={{ marginTop: 12, width: "100%" }}>Ask the seneschal</button>
            </form>
          ) : null}
          {err ? <div className="error">{err}</div> : null}
          <p className="muted" style={{ marginTop: 16 }}>
            Demo: <b>wayfarer@ashmarch.local</b> / Wayfarer#1
            <br />
            Seneschal: <b>seneschal@ashmarch.local</b> / Ashmarch#Seneschal
          </p>
        </div>
      </div>
    );
  }

  if (game?.needCharacter || !game?.character) {
    return (
      <div className="auth-screen">
        <div className="panel auth-card">
          <h2>A new wayfarer</h2>
          <p className="muted">Level 1. Crowns, vault, auction, and banner persist. The pack does not.</p>
          <label>Name</label>
          <input value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} />
          <div style={{ display: "grid", gap: 8, margin: "12px 0" }}>
            {CLASSES.map((c) => (
              <button key={c.id} onClick={() => setCreate({ ...create, class: c.id })} className={create.class === c.id ? "gold" : ""}>
                {c.id} — {c.blurb}
              </button>
            ))}
          </div>
          <button
            className="gold"
            onClick={async () => {
              try {
                await api("/characters", { method: "POST", body: create });
                await reload();
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Denied");
              }
            }}
          >
            Take the road
          </button>
          {err ? <div className="error">{err}</div> : null}
          <button
            style={{ marginTop: 12 }}
            onClick={async () => {
              await api("/auth/logout", { method: "POST" });
              setUser(null);
            }}
          >
            Leave the hall
          </button>
        </div>
      </div>
    );
  }

  const c = game.character;
  const inCity = c.location === "CITY";
  const stats = c.power.stats;

  async function fightNow() {
    try {
      const r = await api<Fight>("/game/fight", { method: "POST" });
      setFight(r);
      if (r.dead) setMode("play");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The road refuses");
    }
  }

  if (fight?.dead && fight.death) {
    const d = fight.death as {
      character: string;
      class: string;
      level: number;
      region: number;
      round: number;
      enemies_defeated: number;
      gold_earned: number;
      best_item: string;
      loot_value: number;
    };
    return (
      <div className="death-screen">
        <div className="panel" style={{ padding: "2rem", maxWidth: 560 }}>
          <h1>Your wayfarer has fallen</h1>
          <p className="muted">The pack is ash. The vault is not.</p>
          <div className="parchment" style={{ padding: "1rem", textAlign: "left", margin: "1rem 0" }}>
            <div>
              <b>{d.character}</b> the {d.class}
            </div>
            <div>Level {d.level}</div>
            <div>Region reached {d.region} · Round {d.round}</div>
            <div>Enemies defeated {d.enemies_defeated}</div>
            <div>Crowns earned this life {d.gold_earned}</div>
            <div>Best piece {d.best_item || "none"}</div>
            <div>Loot value {d.loot_value}</div>
          </div>
          <button
            className="gold"
            onClick={() => {
              setFight(null);
              reload();
            }}
          >
            Create new character
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="panel topbar">
        <div>
          <h1 style={{ fontSize: "1.6rem" }}>
            <span className="torch" /> Ashmarch
          </h1>
          <div className="brand-sub">Tithe of Iron</div>
        </div>
        <div className="statpills">
          <span className="pill">
            {c.name} · {c.class} · Lv {c.level}
          </span>
          <span className="pill">
            HP <b>{c.hp}</b>/{c.max_hp}
          </span>
          <span className="pill">
            Crowns <b>{game.user.coins}</b>
          </span>
          <span className="pill">
            {game.region.name} · Round {c.round}/10
          </span>
          <span className="pill">Highest charted {game.user.highest_region}</span>
        </div>
        <div className="row">
          {inCity ? <button onClick={() => setMode("city")}>Square</button> : null}
          {game.user.role === "admin" ? <button onClick={() => { setMode("admin"); api("/admin/summary").then(setAdmin); }}>Seneschal</button> : null}
          <button
            onClick={async () => {
              await api("/auth/logout", { method: "POST" });
              setUser(null);
              setGame(null);
            }}
          >
            Leave
          </button>
        </div>
      </header>

      {err ? <div className="error panel" style={{ padding: 8, marginBottom: 8 }}>{err}</div> : null}

      <div className="mobile-tabs">
        {(["equip", "pack", "fight", "city", "chat"] as const).map((t) => (
          <button key={t} onClick={() => setMobile(t)}>
            {t}
          </button>
        ))}
      </div>

      {mode === "admin" && admin ? (
        <div className="panel" style={{ padding: 16, marginBottom: 12 }}>
          <h3>Seneschal's Hall</h3>
          <pre className="log" style={{ height: 360, whiteSpace: "pre-wrap" }}>
            {JSON.stringify(admin, null, 2)}
          </pre>
          <button onClick={() => setMode(inCity ? "city" : "play")}>Return</button>
        </div>
      ) : null}

      {mode === "city" && inCity ? (
        <div className="panel city-map" style={{ marginBottom: 12 }}>
          <div style={{ textAlign: "center", paddingTop: 16 }}>
            <h2>Town Square</h2>
            <p className="muted">Safe walls. The vault opens. The road waits.</p>
          </div>
          <div className="building panel" style={{ left: "8%", top: "38%" }} onClick={() => setMode("storage")}>
            <div className="icon">♜</div>
            <div className="name">Vault</div>
            <div className="desc">Your personal safe storage.</div>
          </div>
          <div className="building panel" style={{ left: "32%", top: "48%" }} onClick={async () => { setMode("shop"); setShop(await api("/shop")); }}>
            <div className="icon">⚖</div>
            <div className="name">Stall</div>
            <div className="desc">Buy and sell equipment.</div>
          </div>
          <div className="building panel" style={{ left: "55%", top: "36%" }} onClick={async () => { setMode("auction"); setAuction(await api("/auction")); }}>
            <div className="icon">⚔</div>
            <div className="name">Crier's Board</div>
            <div className="desc">Trade with other adventurers.</div>
          </div>
          <div className="building panel" style={{ left: "76%", top: "50%" }} onClick={async () => { setMode("guild"); setGuilds(await api("/guilds")); setMyGuild(await api("/guild")); }}>
            <div className="icon">🛡</div>
            <div className="name">Company Hall</div>
            <div className="desc">Join forces with other players.</div>
          </div>
          <div style={{ position: "absolute", bottom: 12, left: 0, right: 0, textAlign: "center" }}>
            <button
              className="danger"
              onClick={async () => {
                try {
                  await api("/game/leave-city", { method: "POST" });
                  setMode("play");
                  setFight(null);
                  await reload();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : "The gate is shut");
                }
              }}
            >
              Continue the march
            </button>
          </div>
        </div>
      ) : null}

      {mode === "storage" && game.storage ? (
        <div className="panel inv-wrap" style={{ marginBottom: 12 }}>
          <div className="section-title">The Vault — Level {game.storage.level} ({game.storage.cells} cells)</div>
          <p className="muted">Drag from pack to chest. High-level steel may sleep here until you are worthy.</p>
          <InventoryGrid
            cols={game.storage.cols}
            rows={game.storage.rows}
            items={game.storage.items}
            dest="STORAGE"
            charLevel={c.level}
            onPlace={(id, x, y, rotated) => place(id, "STORAGE", { x, y, rotated })}
            onCtrlClick={linkItem}
            cell={40}
          />
          <button style={{ marginTop: 8 }} onClick={async () => { await api("/storage/upgrade", { method: "POST" }); reload(); }}>
            Enlarge chest ({game.storage.upgradeCost} crowns)
          </button>
          <button onClick={() => setMode("city")}>Back to square</button>
        </div>
      ) : null}

      {mode === "shop" && shop ? (
        <ShopView
          shop={shop}
          onClose={() => setMode("city")}
          reload={async () => {
            setShop(await api("/shop"));
            await reload();
          }}
          setErr={setErr}
        />
      ) : null}

      {mode === "auction" && auction ? (
        <AuctionView
          data={auction}
          hours={hours}
          setHours={setHours}
          price={auctionPrice}
          setPrice={setAuctionPrice}
          pack={game.inventory}
          onList={async (id) => {
            await api("/auction/list", { method: "POST", body: { instanceId: id, price: Number(auctionPrice), hours } });
            setAuction(await api("/auction"));
            await reload();
          }}
          onBuy={async (id) => {
            await api("/auction/buy", { method: "POST", body: { id } });
            setAuction(await api("/auction"));
            await reload();
          }}
          onClose={() => setMode("city")}
          setErr={setErr}
        />
      ) : null}

      {mode === "guild" ? (
        <GuildView
          list={guilds}
          mine={myGuild}
          reload={async () => {
            setGuilds(await api("/guilds"));
            setMyGuild(await api("/guild"));
            await reload();
          }}
          onClose={() => setMode("city")}
          setErr={setErr}
        />
      ) : null}

      <div className="layout">
        <aside className="panel" style={{ padding: 12, display: mobile === "equip" || window.innerWidth > 1100 ? "block" : "none" }}>
          <div className="section-title">Harness</div>
          <div className="equip-grid">
            {SLOTS.map((slot) => {
              const it = game.equipment.find((e) => e.equip_slot === slot);
              return (
                <div
                  key={slot}
                  className={`eq-slot ${it ? "filled" : ""}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    const id = e.dataTransfer.getData("text/item");
                    if (id) place(id, "EQUIPMENT", { slot });
                  }}
                  onDoubleClick={() => it && place(it.id, "INVENTORY")}
                  onClick={(e) => it && (e.ctrlKey || e.metaKey) && linkItem(it)}
                  onMouseEnter={(e) => it && setHoverEq({ item: it, x: e.clientX, y: e.clientY })}
                  onMouseMove={(e) => it && setHoverEq({ item: it, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHoverEq(null)}
                >
                  {it ? (
                    <>
                      <Glyph kind={it.definition.glyph} />
                      <span>{it.definition.name}</span>
                    </>
                  ) : (
                    slot
                  )}
                </div>
              );
            })}
          </div>
          {hoverEq ? <ItemTooltip item={hoverEq.item} x={hoverEq.x} y={hoverEq.y} charLevel={c.level} /> : null}
          <div className="section-title" style={{ marginTop: 12 }}>
            Measure
          </div>
          {Object.entries(stats)
            .filter(([, v]) => v)
            .slice(0, 14)
            .map(([k, v]) => (
              <div key={k} className="muted">
                {fmtStat(k, v)}
              </div>
            ))}
          {c.power.setBonuses?.map((s) => (
            <div key={s.set} className="pill" style={{ marginTop: 6 }}>
              {s.set} {s.pieces}/5
            </div>
          ))}
          <div className="section-title" style={{ marginTop: 12 }}>
            Omens
          </div>
          {game.skills.map((s) => (
            <div key={s.id} className="muted">
              {s.name}: {s.description}
            </div>
          ))}
        </aside>

        <main>
          <div className="panel inv-wrap" style={{ display: mobile === "pack" || window.innerWidth > 1100 ? "block" : "none" }}>
            <div className="section-title">Pack — 10×6 · drag, double-click to wear, right-click to act, turn via the item menu</div>
            <div className="row" style={{ marginBottom: 8 }}>
              <input placeholder="Search the pack…" value={invQ} onChange={(e) => setInvQ(e.target.value)} style={{ maxWidth: 220 }} />
              <select value={invRarity} onChange={(e) => setInvRarity(e.target.value)} style={{ width: 140 }}>
                <option value="">All rarities</option>
                {["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </div>
            {invQ || invRarity ? (
              <p className="muted">
                {game.inventory
                  .filter((i) => (!invQ || i.definition.name.toLowerCase().includes(invQ.toLowerCase())) && (!invRarity || i.rarity === invRarity))
                  .map((i) => i.definition.name)
                  .join(" · ") || "Nothing matches."}
              </p>
            ) : null}
            <InventoryGrid
              cols={game.grid.cols}
              rows={game.grid.rows}
              items={game.inventory}
              dest="INVENTORY"
              charLevel={c.level}
              onPlace={(id, x, y, rotated) => place(id, "INVENTORY", { x, y, rotated })}
              onCtrlClick={linkItem}
              onEquip={(it) => {
                const slot = it.definition.slot;
                if (slot) place(it.id, "EQUIPMENT", { slot: slot === "Ring2" ? "Ring1" : slot });
              }}
              onContext={(it) => setCtx({ item: it, kind: "inv" })}
            />
            {game.ground.length ? (
              <>
                <div className="section-title" style={{ marginTop: 12 }}>
                  On the dirt — if the pack is full, something must be left
                </div>
                <div className="row">
                  {game.ground.map((it) => (
                    <button key={it.id} className={`r-${it.rarity}`} onClick={() => place(it.id, "INVENTORY")} onContextMenu={(e) => { e.preventDefault(); setCtx({ item: it, kind: "ground" }); }}>
                      {it.definition.name} ({it.width}×{it.height})
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>

          <div className="panel" style={{ padding: 12, marginTop: 12, display: mobile === "fight" || window.innerWidth > 1100 ? "block" : "none" }}>
            <div className="section-title">{inCity ? "Safe ground" : game.region.name}</div>
            <p>{game.region.theme}</p>
            <p className="muted">{game.region.description}</p>
            <div className="hpbar">
              <span style={{ width: `${(c.hp / c.max_hp) * 100}%` }} />
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              {([1, 2, 4, 0] as const).map((s) => (
                <button key={s} onClick={() => setSpeed(s)}>
                  {s === 0 ? "AUTO" : `×${s}`}
                </button>
              ))}
              {!inCity && !fight ? (
                <button className="danger" onClick={fightNow}>
                  {c.round === 10 ? "Challenge the boss" : "Begin the clash"}
                </button>
              ) : null}
              {inCity ? <button onClick={() => setMode("city")}>Enter the square</button> : null}
            </div>
            {fight && !fight.dead ? (
              <>
                <div className="log" style={{ marginTop: 8 }}>
                  {fight.log.slice(0, logShown).map((l, i) => (
                    <div key={i} className={/CRITICAL/.test(l.text) ? "crit" : /FALLEN|FALLS/.test(l.text) ? "fall" : /BLEED|POISON|FIRE/.test(l.text) ? "dot" : ""}>
                      {l.text}
                    </div>
                  ))}
                </div>
                {logShown >= fight.log.length && fight.won ? (
                  <div style={{ marginTop: 8 }}>
                    <p>
                      Spoils: {fight.gold} crowns · XP {fight.xpGain}
                    </p>
                    {game.skillChoices?.length ? (
                      <div>
                        <div className="section-title">Choose one omen (this life only)</div>
                        {game.skillChoices.map((s) => (
                          <button
                            key={s.id}
                            onClick={async () => {
                              await api("/game/skill", { method: "POST", body: { skillId: s.id } });
                              await reload();
                            }}
                          >
                            {s.name} — {s.description}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <button
                        className="gold"
                        onClick={async () => {
                          const r = await api<{ city?: boolean }>("/game/advance", { method: "POST" });
                          setFight(null);
                          if (r.city) setMode("city");
                          await reload();
                        }}
                      >
                        Take what you can and walk
                      </button>
                    )}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </main>

        <aside style={{ display: mobile === "chat" || window.innerWidth > 1100 ? "block" : "none" }}>
          <ChatDock
            ws={ws}
            username={game.user.username}
            canGuild={!!game.user.guild_id}
            region={c.region}
            linkQueue={linkQ}
            onConsumedLink={() => setLinkQ(null)}
          />
        </aside>
      </div>

      {ctx ? (
        <div className="modal-back" onClick={() => setCtx(null)}>
          <div className="panel modal" onClick={(e) => e.stopPropagation()}>
            <h3>{ctx.item.definition.name}</h3>
            <p className={`rarity r-${ctx.item.rarity}`}>{ctx.item.rarity}</p>
            <div className="row">
              <button
                onClick={async () => {
                  await api("/items/rotate", { method: "POST", body: { instanceId: ctx.item.id } });
                  setCtx(null);
                  reload();
                }}
              >
                Turn
              </button>
              {ctx.item.definition.slot ? (
                <button onClick={() => { place(ctx.item.id, "EQUIPMENT", { slot: ctx.item.definition.slot }); setCtx(null); }}>Wear</button>
              ) : null}
              {inCity ? (
                <>
                  <button onClick={() => { place(ctx.item.id, "STORAGE"); setCtx(null); }}>To vault</button>
                  <button
                    onClick={async () => {
                      try {
                        const r = await api<{ price: number }>("/shop/sell", { method: "POST", body: { instanceId: ctx.item.id } });
                        setErr(`Sold for ${r.price} crowns`);
                      } catch (e) {
                        setErr(e instanceof Error ? e.message : "No");
                      }
                      setCtx(null);
                      reload();
                    }}
                  >
                    Sell
                  </button>
                </>
              ) : null}
              <button className="danger" onClick={() => { place(ctx.item.id, "DISCARD"); setCtx(null); }}>
                Discard
              </button>
              <button onClick={() => { linkItem(ctx.item); setCtx(null); }}>Seal in speech</button>
            </div>
            <p className="muted">Required {ctx.item.required_level} · Yours {c.level}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ShopView({
  shop,
  onClose,
  reload,
  setErr,
}: {
  shop: Record<string, unknown>;
  onClose: () => void;
  reload: () => Promise<void>;
  setErr: (s: string) => void;
}) {
  const items = (shop.items as { id: string; price: number; item: Item }[]) || [];
  return (
    <div className="panel" style={{ padding: 16, marginBottom: 12 }}>
      <div className="section-title">The Stall — Level {String(shop.level)}</div>
      <div className="row">
        {items.map((s) => (
          <div key={s.id} className={`parchment r-${s.item.rarity}`} style={{ padding: 8, width: 180 }}>
            <b>{s.item.definition.name}</b>
            <div>{s.item.rarity} · Req {s.item.required_level}</div>
            <button
              className="gold"
              onClick={async () => {
                try {
                  await api("/shop/buy", { method: "POST", body: { id: s.id } });
                  await reload();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : "No");
                }
              }}
            >
              Buy {s.price}
            </button>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button
          onClick={async () => {
            try {
              await api("/shop/refresh", { method: "POST" });
              await reload();
            } catch (e) {
              setErr(e instanceof Error ? e.message : "No");
            }
          }}
        >
          Refresh ({String(shop.refreshCost)})
        </button>
        <button
          onClick={async () => {
            try {
              await api("/shop/upgrade", { method: "POST" });
              await reload();
            } catch (e) {
              setErr(e instanceof Error ? e.message : "No");
            }
          }}
        >
          Widen stall ({String(shop.upgradeCost)})
        </button>
        <button onClick={onClose}>Back</button>
      </div>
    </div>
  );
}

function AuctionView({
  data,
  hours,
  setHours,
  price,
  setPrice,
  pack,
  onList,
  onBuy,
  onClose,
  setErr,
}: {
  data: Record<string, unknown>;
  hours: 12 | 24;
  setHours: (h: 12 | 24) => void;
  price: string;
  setPrice: (s: string) => void;
  pack: Item[];
  onList: (id: string) => Promise<void>;
  onBuy: (id: string) => Promise<void>;
  onClose: () => void;
  setErr: (s: string) => void;
}) {
  const listings = (data.listings as { id: string; seller_name: string; price: number; expires_at: number; item: Item }[]) || [];
  const [pick, setPick] = useState(pack[0]?.id || "");
  return (
    <div className="panel" style={{ padding: 16, marginBottom: 12 }}>
      <div className="section-title">Crier's Board — {String(data.cap)} nails</div>
      <p className="muted">
        12h fee {(Number(data.fee12) * 100).toFixed(0)}% · 24h {(Number(data.fee24) * 100).toFixed(0)}% · paid when posted, kept if cancelled or expired
      </p>
      <div className="row">
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          {pack.map((p) => (
            <option key={p.id} value={p.id}>
              {p.definition.name}
            </option>
          ))}
        </select>
        <input value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 100 }} />
        <button onClick={() => setHours(12)}>12h</button>
        <button onClick={() => setHours(24)}>24h</button>
        <button
          className="gold"
          onClick={async () => {
            try {
              await onList(pick);
            } catch (e) {
              setErr(e instanceof Error ? e.message : "No");
            }
          }}
        >
          Nail it ({hours}h)
        </button>
      </div>
      <table style={{ width: "100%", marginTop: 12, fontSize: "0.9rem", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "var(--gold)", textAlign: "left" }}>
            <th>Item</th>
            <th>Rarity</th>
            <th>Lvl</th>
            <th>Seller</th>
            <th>Price</th>
            <th>Time</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {listings.map((l) => (
            <tr key={l.id} style={{ borderBottom: "1px solid #3a2a1a" }}>
              <td>{l.item.definition.name}</td>
              <td>{l.item.rarity}</td>
              <td>{l.item.item_level}</td>
              <td>{l.seller_name}</td>
              <td>{l.price}</td>
              <td>{Math.max(0, Math.round((l.expires_at - Date.now()) / 60000))}m</td>
              <td>
                <button
                  onClick={async () => {
                    try {
                      await onBuy(l.id);
                    } catch (e) {
                      setErr(e instanceof Error ? e.message : "No");
                    }
                  }}
                >
                  Buy
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button style={{ marginTop: 8 }} onClick={onClose}>
        Back
      </button>
    </div>
  );
}

function GuildView({
  list,
  mine,
  reload,
  onClose,
  setErr,
}: {
  list: Record<string, unknown> | null;
  mine: Record<string, unknown> | null;
  reload: () => Promise<void>;
  onClose: () => void;
  setErr: (s: string) => void;
}) {
  const [form, setForm] = useState({ name: "", tag: "", description: "A company of the road.", emblem: "wolf" });
  const guilds = (list?.guilds as { id: string; name: string; tag: string; members: number; level: number }[]) || [];
  const g = mine?.guild as { name: string; tag: string; level: number; description: string } | null;
  return (
    <div className="panel" style={{ padding: 16, marginBottom: 12 }}>
      <div className="section-title">Company Hall</div>
      {g ? (
        <div>
          <h3>
            [{g.tag}] {g.name} · Hall {g.level}
          </h3>
          <p>{g.description}</p>
          <p className="muted">Roster {(mine?.members as unknown[])?.length} / {String(mine?.cap)}</p>
          <button onClick={async () => { await api("/guild/upgrade", { method: "POST" }); reload(); }}>Raise walls ({String(mine?.upgradeCost)})</button>
          <button className="danger" onClick={async () => { await api("/guild/leave", { method: "POST" }); reload(); }}>
            Leave banner
          </button>
        </div>
      ) : (
        <>
          <p className="muted">
            Founding demands region {String(list?.requiredRegion)} charted and {String(list?.cost)} crowns.
          </p>
          <div className="row">
            <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input placeholder="TAG" value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} />
          </div>
          <button
            onClick={async () => {
              try {
                await api("/guilds", { method: "POST", body: form });
                await reload();
              } catch (e) {
                setErr(e instanceof Error ? e.message : "No");
              }
            }}
          >
            Found company
          </button>
          {guilds.map((x) => (
            <div key={x.id} className="row" style={{ marginTop: 6 }}>
              <span>
                [{x.tag}] {x.name} ({x.members}) lv{x.level}
              </span>
              <button onClick={async () => { await api(`/guilds/${x.id}/join`, { method: "POST" }); reload(); }}>Join</button>
            </div>
          ))}
        </>
      )}
      <button style={{ marginTop: 8 }} onClick={onClose}>
        Back
      </button>
    </div>
  );
}
