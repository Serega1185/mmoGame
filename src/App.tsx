import { useCallback, useEffect, useRef, useState } from "react";
import { api, EQUIP_LAYOUT, type Item } from "./api";
import { InventoryGrid } from "./InventoryGrid";
import { ChatDock } from "./ChatDock";
import { ItemFace, ItemTooltip, SetTooltip, fmtStat, statEntries } from "./ui";
import { LangSwitcher, useI18n } from "./i18n";
import { BattleStage, type BattleFoe, type BattleFx } from "./BattleStage";
import { SET_MARK } from "./itemIcons";
import { ForgeView, putForgeSlot } from "./ForgeView";
import { AdminView } from "./AdminView";
import { LootPick } from "./LootPick";
import { TalentTree, type TalentTreeData } from "./TalentTree";
import { MarchMap, type MarchView } from "./MarchMap";
import { fetchStatus, rememberGate, type GateStatus } from "./gate";

const HIT_DELAY_MS = 1000;
const GATE_MS = 60_000;
const DAMAGE_KEYS = new Set(["combat.strike", "combat.dot", "combat.thorns"]);

function hurtFoe(foes: BattleFoe[], id: string, amount: number) {
  const live = foes.findIndex((f) => String(f.id) === id && f.hp > 0);
  const i = live >= 0 ? live : foes.findIndex((f) => String(f.id) === id);
  if (i < 0) return foes;
  const next = foes.slice();
  const cur = next[i]!;
  next[i] = { ...cur, hp: Math.max(0, cur.hp - amount) };
  return next;
}

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
  depth: number;
  hp: number;
  max_hp: number;
  status: string;
  location: string;
  skill_pending: number;
  enemies_defeated: number;
  gold_earned: number;
  power: {
    stats: Record<string, number>;
    maxHp: number;
    setBonuses: {
      set: string;
      setId?: string;
      pieces: number;
      size?: number;
      bonus?: Record<string, number>;
      tiers?: { pieces: number; bonus: Record<string, number> }[];
    }[];
  };
};

type GameState = {
  needCharacter?: boolean;
  user: User;
  character: Character;
  inventory: Item[];
  equipment: Item[];
  ground: Item[];
  lootChoices?: Item[];
  skills: { id: string; name: string; description: string }[];
  skillChoices: { id: string; name: string; description: string }[];
  talentTree?: TalentTreeData;
  talentPoints?: number;
  march?: MarchView;
  region: { name: string; theme: string; description: string };
  grid: { cols: number; rows: number };
  storage: null | { items: Item[]; cols: number; rows: number; cells: number; level: number; upgradeCost: number };
};

type Fight = {
  won: boolean;
  dead?: boolean;
  enemy: { name: string; kind: string; hp: number; id?: string; damage?: number };
  enemies?: { id: string; name: string; kind: string; hp: number; maxHp: number; damage: number }[];
  log: { t: number; text: string; key?: string; vars?: Record<string, string | number> }[];
  gold?: number;
  loot?: Item[];
  xpGain?: number;
  level?: number;
  death?: Record<string, unknown>;
  playerHp: number;
  startPlayerHp?: number;
  playerMaxHp?: number;
};

const CLASS_IDS = ["Ironclad", "Shadehand", "Thornbow"] as const;

export default function App() {
  const { t, te, itemName, setName, regionName, regionTheme, combatLine } = useI18n();
  const [boot, setBoot] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [err, setErr] = useState("");
  const [mode, setMode] = useState<"play" | "city" | "storage" | "shop" | "auction" | "guild" | "forge" | "admin">("play");
  const [mobile, setMobile] = useState<"equip" | "fight" | "stats" | "city" | "chat">("fight");
  const [mapPeek, setMapPeek] = useState(false);
  const [fight, setFight] = useState<Fight | null>(null);
  const [logShown, setLogShown] = useState(0);
  const [playbackDone, setPlaybackDone] = useState(true);
  const [livePlayerHp, setLivePlayerHp] = useState(0);
  const [liveFoes, setLiveFoes] = useState<BattleFoe[]>([]);
  const [battleFx, setBattleFx] = useState<BattleFx | null>(null);
  const logBox = useRef<HTMLDivElement>(null);
  const [linkQ, setLinkQ] = useState<string | null>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [ctx, setCtx] = useState<{ item: Item; kind: string } | null>(null);
  const [auctionPrice, setAuctionPrice] = useState("100");
  const [hours, setHours] = useState<12 | 24>(12);
  const [shop, setShop] = useState<Record<string, unknown> | null>(null);
  const [auction, setAuction] = useState<Record<string, unknown> | null>(null);
  const [guilds, setGuilds] = useState<Record<string, unknown> | null>(null);
  const [myGuild, setMyGuild] = useState<Record<string, unknown> | null>(null);
  const [forgeSlots, setForgeSlots] = useState<(string | null)[]>([null, null, null]);
  const [hoverEq, setHoverEq] = useState<{ item: Item; x: number; y: number } | null>(null);
  const [hoverSet, setHoverSet] = useState<{
    set: Character["power"]["setBonuses"][number];
    x: number;
    y: number;
  } | null>(null);
  const [auth, setAuth] = useState({ email: "", password: "", username: "", tab: "login" as "login" | "register" | "forgot" });
  const [create, setCreate] = useState({ name: "", class: "Ironclad" });
  const [gate, setGate] = useState<GateStatus | null>(null);

  const applyStatus = useCallback((s: GateStatus) => {
    if (rememberGate(s)) {
      location.reload();
      return false;
    }
    setGate(s);
    return true;
  }, []);

  const reload = useCallback(async () => {
    try {
      const st = await fetchStatus();
      if (!applyStatus(st)) return;
      const me = await api<{ user: User; characters: Character[] }>("/me");
      setUser(me.user);
      if (st.maintenance && me.user.role !== "admin") {
        setGame(null);
        setErr("");
        return;
      }
      const g = await api<GameState>("/game");
      setGame(g.needCharacter ? ({ needCharacter: true, user: me.user } as GameState) : g);
      setErr("");
    } catch {
      setUser(null);
      setGame(null);
    } finally {
      setBoot(false);
    }
  }, [applyStatus]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const tick = async () => {
      try {
        const st = await fetchStatus();
        applyStatus(st);
      } catch {
        /* road silent */
      }
    };
    const id = setInterval(tick, GATE_MS);
    return () => clearInterval(id);
  }, [applyStatus]);

  useEffect(() => {
    if (!user) return;
    if (gate?.maintenance && user.role !== "admin") return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const sock = new WebSocket(`${proto}://${location.host}/ws`);
    const ping = setInterval(() => sock.readyState === 1 && sock.send(JSON.stringify({ type: "ping" })), 20000);
    setWs(sock);
    return () => {
      clearInterval(ping);
      sock.close();
    };
  }, [user?.id, gate?.maintenance]);

  useEffect(() => {
    logBox.current?.scrollTo({ top: logBox.current.scrollHeight, behavior: "smooth" });
  }, [logShown]);

  useEffect(() => {
    if (!fight) {
      setBattleFx(null);
      setPlaybackDone(true);
      return;
    }
    let cancelled = false;
    const log = fight.log;
    const cap = Math.max(1, fight.playerMaxHp ?? fight.startPlayerHp ?? 1);
    let pHp = fight.startPlayerHp ?? cap;
    let foes: BattleFoe[] = (fight.enemies?.length
      ? fight.enemies
      : [
          {
            id: fight.enemy.id,
            name: fight.enemy.name,
            kind: fight.enemy.kind,
            hp: 0,
            maxHp: fight.enemy.hp,
            damage: fight.enemy.damage || 0,
          },
        ]
    ).map((e) => ({ ...e, hp: e.maxHp }));
    setLivePlayerHp(pHp);
    setLiveFoes(foes);
    setLogShown(0);
    setPlaybackDone(false);
    setBattleFx(null);
    let fxN = 0;
    let pendingCrit = false;

    (async () => {
      let i = 0;
      while (!cancelled && i < log.length) {
        let hit = false;
        while (!cancelled && i < log.length) {
          const line = log[i]!;
          if (hit && DAMAGE_KEYS.has(line.key || "")) break;
          i += 1;
          if (line.key === "combat.crit") pendingCrit = true;
          if (line.key === "combat.strike") {
            const dealt = Number(line.vars?.dealt || 0);
            const def = String(line.vars?.defId || "");
            const att = String(line.vars?.attId || "");
            if (def === "player") pHp = Math.max(0, pHp - dealt);
            else foes = hurtFoe(foes, def, dealt);
            fxN += 1;
            setBattleFx({ n: fxN, att, def, dealt, crit: pendingCrit });
            pendingCrit = false;
            setLivePlayerHp(pHp);
            setLiveFoes(foes);
            hit = true;
          } else if (line.key === "combat.dot") {
            const dmg = Number(line.vars?.dmg || 0);
            const id = String(line.vars?.id || "");
            if (id === "player") pHp = Math.max(0, pHp - dmg);
            else foes = hurtFoe(foes, id, dmg);
            fxN += 1;
            setBattleFx({ n: fxN, att: "", def: id, dealt: dmg, dot: true });
            setLivePlayerHp(pHp);
            setLiveFoes(foes);
            hit = true;
          } else if (line.key === "combat.thorns") {
            const dmg = Number(line.vars?.dmg || 0);
            const att = String(line.vars?.attId || "");
            if (att === "player") pHp = Math.max(0, pHp - dmg);
            else foes = hurtFoe(foes, att, dmg);
            fxN += 1;
            setBattleFx({ n: fxN, att: String(line.vars?.def || ""), def: att, dealt: dmg, dot: true });
            setLivePlayerHp(pHp);
            setLiveFoes(foes);
            hit = true;
          } else if (line.key === "combat.regen") {
            const hp = Number(line.vars?.hp || 0);
            const id = String(line.vars?.id || "");
            if (id === "player") pHp = Math.min(cap, pHp + hp);
            else {
              foes = foes.map((f) =>
                String(f.id) === id ? { ...f, hp: Math.min(f.maxHp, f.hp + hp) } : f
              );
            }
            setLivePlayerHp(pHp);
            setLiveFoes(foes);
          } else if (line.key === "combat.leech") {
            const ls = Number(line.vars?.ls || 0);
            const att = String(line.vars?.attId || "");
            if (att === "player") pHp = Math.min(cap, pHp + ls);
            else {
              foes = foes.map((f) =>
                String(f.id) === att ? { ...f, hp: Math.min(f.maxHp, f.hp + ls) } : f
              );
            }
            setLivePlayerHp(pHp);
            setLiveFoes(foes);
          }
          setLogShown(i);
        }
        if (hit && !cancelled) await new Promise((r) => setTimeout(r, HIT_DELAY_MS));
        if (!hit) break;
      }
      if (!cancelled) {
        if (!fight.dead) {
          try {
            await reload();
          } catch {
            /* keep the replay even if the ledger hiccups */
          }
        }
        setPlaybackDone(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fight?.log]);

  async function linkItem(item: Item) {
    try {
      const d = await api<{ token: string; name: string }>("/items/link", { method: "POST", body: { instanceId: item.id } });
      setLinkQ(`[${d.name}](${d.token})`);
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "Seal failed"));
    }
  }

  async function place(id: string, dest: "INVENTORY" | "STORAGE" | "EQUIPMENT" | "DISCARD", extra: Record<string, unknown> = {}) {
    try {
      await api("/items/move", { method: "POST", body: { instanceId: id, dest, ...extra } });
      await reload();
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "Cannot move"));
    }
  }

  if (boot) {
    return (
      <div className="auth-screen">
        <div className="lang-bar">
          <LangSwitcher />
        </div>
        <h1>{t("brand")}</h1>
        <p className="brand-sub">{t("boot")}</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="auth-screen">
        <div className="lang-bar">
          <LangSwitcher />
        </div>
        {gate?.maintenance ? (
          <div className="panel auth-card maint-card" style={{ marginBottom: 12 }}>
            <h1>{t("brand")}</h1>
            <p className="brand-sub">{t("maintTitle")}</p>
            <p className="maint-copy">{gate.message.trim() || t("maintDefault")}</p>
          </div>
        ) : null}
        <div className="panel auth-card">
          <div style={{ textAlign: "center" }}>
            <span className="torch" />
            <h1>{t("brand")}</h1>
            <div className="brand-sub">{t("subtitle")}</div>
            <p className="muted">{t("tagline")}</p>
          </div>
          <div className="row" style={{ justifyContent: "center", margin: "1rem 0" }}>
            <button onClick={() => setAuth((a) => ({ ...a, tab: "login" }))}>{t("enter")}</button>
            <button onClick={() => setAuth((a) => ({ ...a, tab: "register" }))}>{t("enlist")}</button>
            <button onClick={() => setAuth((a) => ({ ...a, tab: "forgot" }))}>{t("lostKey")}</button>
          </div>
          {auth.tab !== "login" ? null : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api("/auth/login", { method: "POST", body: { email: auth.email, password: auth.password } });
                  await reload();
                } catch (er) {
                  setErr(te(er instanceof Error ? er.message : "Denied"));
                }
              }}
            >
              <label>{t("email")}</label>
              <input value={auth.email} onChange={(e) => setAuth({ ...auth, email: e.target.value })} />
              <label>{t("password")}</label>
              <input type="password" value={auth.password} onChange={(e) => setAuth({ ...auth, password: e.target.value })} />
              <button className="gold" style={{ marginTop: 12, width: "100%" }}>
                {t("breakSeal")}
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
                  setErr(te(er instanceof Error ? er.message : "Denied"));
                }
              }}
            >
              <label>{t("email")}</label>
              <input value={auth.email} onChange={(e) => setAuth({ ...auth, email: e.target.value })} />
              <label>{t("password")}</label>
              <input type="password" value={auth.password} onChange={(e) => setAuth({ ...auth, password: e.target.value })} />
              <label>{t("username")}</label>
              <input value={auth.username} onChange={(e) => setAuth({ ...auth, username: e.target.value })} />
              <button className="gold" style={{ marginTop: 12, width: "100%" }}>
                {t("carveName")}
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
                  setErr(te(er instanceof Error ? er.message : "Denied"));
                }
              }}
            >
              <label>{t("email")}</label>
              <input value={auth.email} onChange={(e) => setAuth({ ...auth, email: e.target.value })} />
              <button style={{ marginTop: 12, width: "100%" }}>{t("askSeneschal")}</button>
            </form>
          ) : null}
          {err ? <div className="error">{err}</div> : null}
          <p className="muted" style={{ marginTop: 16 }}>
            {t("demo")}: <b>wayfarer@ashmarch.local</b> / Wayfarer#1
            <br />
            {t("seneschal")}: <b>seneschal@ashmarch.local</b> / Ashmarch#Seneschal
          </p>
        </div>
      </div>
    );
  }

  if (gate?.maintenance && user.role !== "admin") {
    return (
      <div className="auth-screen">
        <div className="lang-bar">
          <LangSwitcher />
        </div>
        <div className="panel auth-card maint-card">
          <h1>{t("brand")}</h1>
          <p className="brand-sub">{t("maintTitle")}</p>
          <p className="maint-copy">{gate.message.trim() || t("maintDefault")}</p>
          {err ? <div className="error">{err}</div> : null}
          <button
            style={{ marginTop: 16 }}
            onClick={async () => {
              await api("/auth/logout", { method: "POST" });
              setUser(null);
            }}
          >
            {t("leaveHall")}
          </button>
        </div>
      </div>
    );
  }

  if (game?.needCharacter || !game?.character) {
    if (mode === "admin") {
      return (
        <div className="auth-screen" style={{ alignItems: "stretch", padding: 16 }}>
          <div className="lang-bar">
            <LangSwitcher />
          </div>
          {err ? <div className="error panel" style={{ padding: 8, marginBottom: 8 }}>{err}</div> : null}
          <AdminView onClose={() => setMode("play")} reload={reload} setErr={setErr} />
        </div>
      );
    }
    return (
      <div className="auth-screen">
        <div className="lang-bar">
          <LangSwitcher />
        </div>
        <div className="panel auth-card">
          <h2>{t("newWayfarer")}</h2>
          <p className="muted">{t("newWayfarerHint")}</p>
          <label>{t("name")}</label>
          <input value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} />
          <div style={{ display: "grid", gap: 8, margin: "12px 0" }}>
            {CLASS_IDS.map((id) => (
              <button key={id} onClick={() => setCreate({ ...create, class: id })} className={create.class === id ? "gold" : ""}>
                {t(`class_${id}`)} — {t(`blurb_${id}`)}
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
                setErr(te(e instanceof Error ? e.message : "Denied"));
              }
            }}
          >
            {t("takeRoad")}
          </button>
          {err ? <div className="error">{err}</div> : null}
          <button
            style={{ marginTop: 12 }}
            onClick={async () => {
              await api("/auth/logout", { method: "POST" });
              setUser(null);
            }}
          >
            {t("leaveHall")}
          </button>
          {game.user.role === "admin" ? (
            <button style={{ marginTop: 8 }} onClick={() => setMode("admin")}>
              {t("seneschalHall")}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const c = game.character;
  const maxHp = c.power.maxHp || c.max_hp;
  const inCity = c.location === "CITY";
  const stats = c.power.stats;
  const displayHp = Math.min(fight ? livePlayerHp : c.hp, fight?.playerMaxHp ?? maxHp);
  const waitingReplay = !!(fight && !fight.dead && !playbackDone);
  const lootOffers = waitingReplay ? [] : game.lootChoices || [];
  const showBattle = !!(fight && !fight.dead && !playbackDone);
  const march = game.march;

  async function travelTo(nodeId: string) {
    try {
      const startPlayerHp = c.hp;
      const playerMaxHp = maxHp;
      const r = await api<Fight & { action?: string }>("/game/travel", { method: "POST", body: { nodeId } });
      setMapPeek(false);
      if (r.action === "city") {
        setFight(null);
        setMode("city");
        await reload();
        return;
      }
      if (r.action === "loot" || !r.enemy) {
        setFight(null);
        await reload();
        return;
      }
      const packed: Fight = { ...r, startPlayerHp, playerMaxHp };
      setLivePlayerHp(startPlayerHp);
      setLiveFoes(
        (packed.enemies?.length
          ? packed.enemies
          : [
              {
                id: packed.enemy.id,
                name: packed.enemy.name,
                kind: packed.enemy.kind,
                hp: packed.enemy.hp,
                maxHp: packed.enemy.hp,
                damage: packed.enemy.damage || 0,
              },
            ]
        ).map((e) => ({ ...e, hp: e.maxHp }))
      );
      setFight(packed);
      if (r.dead) setMode("play");
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "The road refuses"));
    }
  }

  if (fight?.dead && fight.death && playbackDone) {
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
        <div className="lang-bar">
          <LangSwitcher />
        </div>
        <div className="panel" style={{ padding: "2rem", maxWidth: 560 }}>
          <h1>{t("fallenTitle")}</h1>
          <p className="muted">{t("fallenHint")}</p>
          <div className="parchment" style={{ padding: "1rem", textAlign: "left", margin: "1rem 0" }}>
            <div>
              <b>{d.character}</b> {t(`class_${d.class}`) || d.class}
            </div>
            <div>{t("levelReached", { level: d.level })}</div>
            <div>{t("regionReached", { region: d.region, round: d.round })}</div>
            <div>{t("enemiesDefeated", { n: d.enemies_defeated })}</div>
            <div>{t("goldEarned", { n: d.gold_earned })}</div>
            <div>{t("bestPiece", { name: d.best_item || t("none") })}</div>
            <div>{t("lootValue", { n: d.loot_value })}</div>
          </div>
          <button
            className="gold"
            onClick={() => {
              setFight(null);
              reload();
            }}
          >
            {t("createNew")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="panel topbar">
        <div className="hero-chip">
          <img
            className="hero-portrait"
            src="/assets/pers/1.png"
            alt=""
            onError={(e) => {
              const el = e.currentTarget;
              if (!el.dataset.fb) {
                el.dataset.fb = "1";
                el.src = "/assets/pers/1.svg";
              }
            }}
          />
          <div>
            <div className="hero-name">{c.name}</div>
            <div className="muted hero-class">
              {t(`class_${c.class}`) || c.class} · {c.level}
            </div>
          </div>
        </div>
        <div className="statpills">
          <span className="pill pill-coins">
            <span className="coin-ico" aria-hidden>
              ●
            </span>
            {t("crowns")} <b>{game.user.coins}</b>
          </span>
          <span className="pill">{t("roundOf", { round: c.round })}</span>
          <span className="pill">{t("depthOf", { n: c.depth || 0 })}</span>
        </div>
        <div className="row topbar-actions">
          <button className="map-btn" type="button" title={t("openMap")} onClick={() => setMapPeek(true)}>
            {t("openMap")}
          </button>
          <LangSwitcher />
          {inCity ? <button onClick={() => setMode("city")}>{t("square")}</button> : null}
          {game.user.role === "admin" ? <button onClick={() => setMode("admin")}>{t("seneschalHall")}</button> : null}
          <button
            onClick={async () => {
              await api("/auth/logout", { method: "POST" });
              setUser(null);
              setGame(null);
            }}
          >
            {t("leave")}
          </button>
        </div>
      </header>

      {err ? <div className="error panel" style={{ padding: 8, marginBottom: 8 }}>{err}</div> : null}

      {mode === "admin" ? null : (
      <div className="mobile-tabs">
        {(["equip", "fight", "stats", "city", "chat"] as const).map((tab) => (
          <button key={tab} onClick={() => setMobile(tab)}>
            {tab === "stats" ? t("statsTab") : t(`tab${tab[0].toUpperCase()}${tab.slice(1)}`)}
          </button>
        ))}
      </div>
      )}

      {mode === "admin" ? (
        <AdminView onClose={() => setMode(inCity ? "city" : "play")} reload={reload} setErr={setErr} />
      ) : null}

      {mode === "admin" ? null : (
      <div className="layout">
        <aside className="panel left-panel" style={{ display: mobile === "equip" || window.innerWidth > 1100 ? "block" : "none" }}>
              <div className="section-title">{t("characterLabel")}</div>
              <div className="hero-vitals">
                <div className="hpbar hero wide">
                  <span style={{ width: `${(displayHp / Math.max(1, maxHp)) * 100}%` }} />
                  <em>
                    {displayHp}/{maxHp}
                  </em>
                </div>
                <div className="armor-badge" title={t("stat_armor")}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#c8c4bc" strokeWidth="1.6">
                    <path d="M12 3 L20 6 V12 C20 17 12 21 12 21 C12 21 4 17 4 12 V6 Z" />
                  </svg>
                  <b>{Math.round(stats.armor || 0)}</b>
                </div>
              </div>

              <div className="gear-block">
                <div className="set-col">
                  {(c.power.setBonuses || []).map((s) => {
                    const n = s.pieces || 0;
                    const size = s.size || 5;
                    const lit = n > 0;
                    const full = n >= size;
                    return (
                      <div
                        key={s.setId || s.set}
                        className={`set-chip${lit ? " on" : " off"}${full ? " full" : ""}`}
                        onMouseEnter={(e) => setHoverSet({ set: s, x: e.clientX, y: e.clientY })}
                        onMouseMove={(e) => setHoverSet({ set: s, x: e.clientX, y: e.clientY })}
                        onMouseLeave={() => setHoverSet(null)}
                      >
                        <span className="set-mark">{SET_MARK[s.setId || ""] || "◆"}</span>
                        <span className="set-n">
                          {n}/{size}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="equip-grid">
                  {EQUIP_LAYOUT.map(({ slot, pos }) => {
                    const it = game.equipment.find((e) => e.equip_slot === slot);
                    return (
                      <div
                        key={slot}
                        className={`eq-slot eq-${pos} cell ${it ? `has-item filled r-${it.rarity}` : ""}`}
                        title={t(`slot_${slot}`)}
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
                          <div
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData("text/item", it.id);
                              e.dataTransfer.setData("text/from", "EQUIPMENT");
                            }}
                            style={{ position: "absolute", inset: 0, cursor: "grab" }}
                          >
                            <ItemFace item={it} />
                          </div>
                        ) : (
                          <span className="eq-slot-name">{t(`slot_${slot}`)}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              {hoverEq ? <ItemTooltip item={hoverEq.item} x={hoverEq.x} y={hoverEq.y} charLevel={c.level} /> : null}
              {hoverSet ? <SetTooltip set={hoverSet.set} x={hoverSet.x} y={hoverSet.y} /> : null}

              <div className="pack-mini">
                <div className="section-title">{t("packLabel")}</div>
                <InventoryGrid
                  cols={game.grid.cols}
                  rows={game.grid.rows}
                  items={mode === "forge" ? game.inventory.filter((i) => !forgeSlots.includes(i.id)) : game.inventory}
                  dest="INVENTORY"
                  charLevel={c.level}
                  cell={70}
                  onPlace={(id, x, y, rotated) => place(id, "INVENTORY", { x, y, rotated })}
                  onCtrlClick={linkItem}
                  onEquip={(it) => {
                    const slot = it.definition.slot;
                    if (slot) place(it.id, "EQUIPMENT", { slot: slot === "Ring2" ? "Ring1" : slot });
                  }}
                  onContext={(it) => setCtx({ item: it, kind: "inv" })}
                  onPick={(it) => {
                    if (mode === "forge") setForgeSlots(putForgeSlot(forgeSlots, it.id));
                  }}
                />
                {game.ground.length || game.inventory.some((i) => i.grid_x == null) ? (
                  <>
                    <div className="section-title" style={{ marginTop: 10 }}>
                      {t("onDirt")}
                    </div>
                    <div className="row">
                      {[...game.ground, ...game.inventory.filter((i) => i.grid_x == null)].map((it) => (
                        <button
                          key={it.id}
                          className={`r-${it.rarity} dirt-chip`}
                          onClick={() => place(it.id, "INVENTORY")}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setCtx({ item: it, kind: "ground" });
                          }}
                        >
                          <ItemFace item={it} />
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
        </aside>

        <main>
          {mode === "storage" && game.storage ? (
            <div className="panel inv-wrap center-pane">
              <div className="section-title">{t("vaultTitle", { level: game.storage.level, cells: game.storage.cells })}</div>
              <p className="muted">{t("vaultHint")}</p>
              <InventoryGrid
                cols={game.storage.cols}
                rows={game.storage.rows}
                items={game.storage.items}
                dest="STORAGE"
                charLevel={c.level}
                onPlace={(id, x, y, rotated) => place(id, "STORAGE", { x, y, rotated })}
                onCtrlClick={linkItem}
                cell={70}
              />
              <div className="row" style={{ marginTop: 8 }}>
                <button onClick={async () => { await api("/storage/upgrade", { method: "POST" }); reload(); }}>
                  {t("enlargeChest", { cost: game.storage.upgradeCost })}
                </button>
                <button onClick={() => setMode("city")}>{t("backSquare")}</button>
              </div>
            </div>
          ) : mode === "shop" && shop ? (
            <ShopView
              shop={shop}
              charLevel={c.level}
              onClose={() => setMode("city")}
              reload={async () => {
                setShop(await api("/shop"));
                await reload();
              }}
              setErr={setErr}
            />
          ) : mode === "auction" && auction ? (
            <AuctionView
              data={auction}
              hours={hours}
              setHours={setHours}
              price={auctionPrice}
              setPrice={setAuctionPrice}
              pack={game.inventory}
              charLevel={c.level}
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
          ) : mode === "guild" ? (
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
          ) : mode === "forge" ? (
            <ForgeView
              pack={game.inventory}
              slots={forgeSlots}
              setSlots={setForgeSlots}
              charLevel={c.level}
              coins={game.user.coins}
              onClose={() => {
                setForgeSlots([null, null, null]);
                setMode("city");
              }}
              reload={reload}
              setErr={setErr}
            />
          ) : inCity ? (
            <div className="panel city-map center-pane">
              <div style={{ textAlign: "center", paddingTop: 16 }}>
                <h2>{t("townSquare")}</h2>
                <p className="muted">{t("townHint")}</p>
              </div>
              <div className="building panel" style={{ left: "8%", top: "38%" }} onClick={() => setMode("storage")}>
                <div className="icon">♜</div>
                <div className="name">{t("vault")}</div>
                <div className="desc">{t("vaultDesc")}</div>
              </div>
              <div className="building panel" style={{ left: "28%", top: "24%" }} onClick={() => { setForgeSlots([null, null, null]); setMode("forge"); }}>
                <div className="icon">⚒</div>
                <div className="name">{t("forge")}</div>
                <div className="desc">{t("forgeDesc")}</div>
              </div>
              <div className="building panel" style={{ left: "48%", top: "48%" }} onClick={async () => { setMode("shop"); setShop(await api("/shop")); }}>
                <div className="icon">⚖</div>
                <div className="name">{t("stall")}</div>
                <div className="desc">{t("stallDesc")}</div>
              </div>
              <div className="building panel" style={{ left: "68%", top: "28%" }} onClick={async () => { setMode("auction"); setAuction(await api("/auction")); }}>
                <div className="icon">⚔</div>
                <div className="name">{t("crierBoard")}</div>
                <div className="desc">{t("crierDesc")}</div>
              </div>
              <div className="building panel" style={{ left: "78%", top: "54%" }} onClick={async () => { setMode("guild"); setGuilds(await api("/guilds")); setMyGuild(await api("/guild")); }}>
                <div className="icon">🛡</div>
                <div className="name">{t("companyHall")}</div>
                <div className="desc">{t("companyDesc")}</div>
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
                      setErr(te(e instanceof Error ? e.message : "The gate is shut"));
                    }
                  }}
                >
                  {t("continueMarch")}
                </button>
              </div>
            </div>
          ) : showBattle ? (
            <div className="panel battle-wrap" style={{ display: mobile === "fight" || window.innerWidth > 1100 ? "block" : "none" }}>
              <BattleStage
                playerName={c.name}
                playerHp={livePlayerHp}
                playerMax={fight?.playerMaxHp ?? maxHp}
                foes={liveFoes}
                inCity={false}
                fx={battleFx}
              />
              <div className="log" ref={logBox} style={{ marginTop: 8 }}>
                {(fight?.log || []).slice(0, logShown).map((l, i) => (
                  <div key={i} className={l.key === "combat.crit" ? "crit" : l.key === "combat.falls" || l.key === "combat.fallen" ? "fall" : l.key === "combat.bleed" || l.key === "combat.poison" || l.key === "combat.burn" || l.key === "combat.freeze" || l.key === "combat.dot" || l.key === "combat.thorns" || l.key === "combat.barrier" ? "dot" : ""}>
                    {combatLine(l)}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="panel battle-wrap" style={{ display: mobile === "fight" || window.innerWidth > 1100 ? "block" : "none" }}>
              {march ? (
                <MarchMap march={march} interactive={!inCity && !lootOffers.length} onPick={travelTo} />
              ) : (
                <p className="muted">{t("mapHint")}</p>
              )}
              {fight && fight.won && playbackDone ? (
                <p className="muted" style={{ textAlign: "center" }}>{t("spoils", { gold: fight.gold ?? 0, xp: fight.xpGain ?? 0 })}</p>
              ) : null}
            </div>
          )}
        </main>
        <aside className="panel right-panel" style={{ display: mobile === "stats" || window.innerWidth > 1100 ? "block" : "none" }}>
          <div className="stats-sheet">
            <div className="section-title">{t("statsTab")}</div>
            {statEntries(stats).map(([k, v]) => (
              <div key={k} className="muted">
                {fmtStat(k, v, t(`stat_${k}`))}
              </div>
            ))}
            {game.talentTree ? (
              <TalentTree
                tree={game.talentTree}
                points={game.talentPoints || 0}
                reload={reload}
                setErr={setErr}
              />
            ) : null}
          </div>
        </aside>
      </div>
      )}

      <ChatDock
        ws={ws}
        username={game.user.username}
        canGuild={!!game.user.guild_id}
        region={c.region}
        linkQueue={linkQ}
        onConsumedLink={() => setLinkQ(null)}
        forceOpen={mobile === "chat"}
      />

      {mapPeek && march ? (
        <div className="modal-back map-peek" onClick={() => setMapPeek(false)}>
          <div className="panel modal map-peek-panel" onClick={(e) => e.stopPropagation()}>
            <MarchMap
              march={march}
              interactive={!inCity && !lootOffers.length && !showBattle}
              onPick={travelTo}
            />
            <button onClick={() => setMapPeek(false)}>{t("closeMap")}</button>
          </div>
        </div>
      ) : null}

      {lootOffers.length ? (
        <LootPick
          items={lootOffers}
          charLevel={c.level}
          setErr={setErr}
          onDone={async () => {
            setFight(null);
            await reload();
          }}
        />
      ) : null}

      {ctx ? (
        <div className="modal-back" onClick={() => setCtx(null)}>
          <div className="panel modal" onClick={(e) => e.stopPropagation()}>
            <h3>{itemName(ctx.item)}</h3>
            <p className={`rarity r-${ctx.item.rarity}`}>{t(`rarity_${ctx.item.rarity}`)}</p>
            <div className="row">
              {ctx.item.definition.slot ? (
                <button onClick={() => { place(ctx.item.id, "EQUIPMENT", { slot: ctx.item.definition.slot }); setCtx(null); }}>{t("wear")}</button>
              ) : null}
              {inCity ? (
                <>
                  <button onClick={() => { place(ctx.item.id, "STORAGE"); setCtx(null); }}>{t("toVault")}</button>
                  <button
                    onClick={async () => {
                      try {
                        const r = await api<{ price: number }>("/shop/sell", { method: "POST", body: { instanceId: ctx.item.id } });
                        setErr(t("soldFor", { price: r.price }));
                      } catch (e) {
                        setErr(te(e instanceof Error ? e.message : "No"));
                      }
                      setCtx(null);
                      reload();
                    }}
                  >
                    {t("sell")}
                  </button>
                </>
              ) : null}
              <button className="danger" onClick={() => { place(ctx.item.id, "DISCARD"); setCtx(null); }}>
                {t("discard")}
              </button>
              <button onClick={() => { linkItem(ctx.item); setCtx(null); }}>{t("sealSpeech")}</button>
            </div>
            <p className="muted">{t("requiredYours", { need: ctx.item.required_level, have: c.level })}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ShopView({
  shop,
  charLevel,
  onClose,
  reload,
  setErr,
}: {
  shop: Record<string, unknown>;
  charLevel?: number;
  onClose: () => void;
  reload: () => Promise<void>;
  setErr: (s: string) => void;
}) {
  const { t, te, itemName } = useI18n();
  const items = (shop.items as { id: string; price: number; item: Item }[]) || [];
  const [hover, setHover] = useState<{ item: Item; x: number; y: number } | null>(null);
  return (
    <div className="panel center-pane" style={{ padding: 16 }}>
      <div className="section-title">{t("stallTitle", { level: String(shop.level) })}</div>
      <div className="stall-list">
        {items.map((s) => (
          <div key={s.id} className="stall-row">
            <div
              className={`cell has-item r-${s.item.rarity} board-slot stall-slot`}
              onMouseEnter={(e) => setHover({ item: s.item, x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => setHover({ item: s.item, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setHover(null)}
            >
              <ItemFace item={s.item} />
            </div>
            <div className="stall-info">
              <b>{itemName(s.item)}</b>
              <div className="muted">
                {t(`rarity_${s.item.rarity}`)} · {t("requiredLevel", { n: s.item.required_level })}
              </div>
            </div>
            <button
              className="gold"
              onClick={async () => {
                try {
                  await api("/shop/buy", { method: "POST", body: { id: s.id } });
                  await reload();
                } catch (e) {
                  setErr(te(e instanceof Error ? e.message : "No"));
                }
              }}
            >
              {t("buy", { price: s.price })}
            </button>
          </div>
        ))}
      </div>
      {hover ? <ItemTooltip item={hover.item} x={hover.x} y={hover.y} charLevel={charLevel} /> : null}
      <div className="row" style={{ marginTop: 8 }}>
        <button
          onClick={async () => {
            try {
              await api("/shop/refresh", { method: "POST" });
              await reload();
            } catch (e) {
              setErr(te(e instanceof Error ? e.message : "No"));
            }
          }}
        >
          {t("refresh", { cost: String(shop.refreshCost) })}
        </button>
        <button
          onClick={async () => {
            try {
              await api("/shop/upgrade", { method: "POST" });
              await reload();
            } catch (e) {
              setErr(te(e instanceof Error ? e.message : "No"));
            }
          }}
        >
          {t("widenStall", { cost: String(shop.upgradeCost) })}
        </button>
        <button onClick={onClose}>{t("back")}</button>
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
  charLevel,
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
  charLevel?: number;
  onList: (id: string) => Promise<void>;
  onBuy: (id: string) => Promise<void>;
  onClose: () => void;
  setErr: (s: string) => void;
}) {
  const { t, te, itemName } = useI18n();
  const listings = (data.listings as { id: string; seller_name: string; price: number; expires_at: number; item: Item }[]) || [];
  const [pick, setPick] = useState(pack[0]?.id || "");
  const [hover, setHover] = useState<{ item: Item; x: number; y: number } | null>(null);
  return (
    <div className="panel center-pane" style={{ padding: 16 }}>
      <div className="section-title">{t("boardTitle", { cap: String(data.cap) })}</div>
      <p className="muted">
        {t("boardFees", { fee12: (Number(data.fee12) * 100).toFixed(0), fee24: (Number(data.fee24) * 100).toFixed(0) })}
      </p>
      <div className="row">
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          {pack.map((p) => (
            <option key={p.id} value={p.id}>
              {itemName(p)}
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
              setErr(te(e instanceof Error ? e.message : "No"));
            }
          }}
        >
          {t("nailIt", { hours })}
        </button>
      </div>
      <table className="board-table" style={{ width: "100%", marginTop: 12, fontSize: "0.9rem", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "var(--gold)", textAlign: "left" }}>
            <th></th>
            <th>{t("item")}</th>
            <th>{t("rarity")}</th>
            <th>{t("seller")}</th>
            <th>{t("price")}</th>
            <th>{t("time")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {listings.map((l) => (
            <tr key={l.id} style={{ borderBottom: "1px solid #3a2a1a" }}>
              <td>
                <div
                  className={`cell has-item r-${l.item.rarity} board-slot`}
                  onMouseEnter={(e) => setHover({ item: l.item, x: e.clientX, y: e.clientY })}
                  onMouseMove={(e) => setHover({ item: l.item, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHover(null)}
                >
                  <ItemFace item={l.item} />
                </div>
              </td>
              <td>{itemName(l.item)}</td>
              <td>{t(`rarity_${l.item.rarity}`)}</td>
              <td>{l.seller_name}</td>
              <td>{l.price}</td>
              <td>{Math.max(0, Math.round((l.expires_at - Date.now()) / 60000))}m</td>
              <td>
                <button
                  onClick={async () => {
                    try {
                      await onBuy(l.id);
                    } catch (e) {
                      setErr(te(e instanceof Error ? e.message : "No"));
                    }
                  }}
                >
                  {t("buyAction")}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hover ? <ItemTooltip item={hover.item} x={hover.x} y={hover.y} charLevel={charLevel} /> : null}
      <button style={{ marginTop: 8 }} onClick={onClose}>
        {t("back")}
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
  const { t, te } = useI18n();
  const [form, setForm] = useState({ name: "", tag: "", description: "A company of the road.", emblem: "wolf" });
  const guilds = (list?.guilds as { id: string; name: string; tag: string; members: number; level: number }[]) || [];
  const g = mine?.guild as { name: string; tag: string; level: number; description: string } | null;
  return (
    <div className="panel center-pane" style={{ padding: 16 }}>
      <div className="section-title">{t("hallTitle")}</div>
      {g ? (
        <div>
          <h3>
            [{g.tag}] {g.name} · {t("hallLv", { level: g.level })}
          </h3>
          <p>{g.description}</p>
          <p className="muted">{t("roster", { n: String((mine?.members as unknown[])?.length ?? 0), cap: String(mine?.cap) })}</p>
          <button onClick={async () => { await api("/guild/upgrade", { method: "POST" }); reload(); }}>{t("raiseWalls", { cost: String(mine?.upgradeCost) })}</button>
          <button className="danger" onClick={async () => { await api("/guild/leave", { method: "POST" }); reload(); }}>
            {t("leaveBanner")}
          </button>
        </div>
      ) : (
        <>
          <p className="muted">
            {t("foundingHint", { region: String(list?.requiredRegion), cost: String(list?.cost) })}
          </p>
          <div className="row">
            <input placeholder={t("name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input placeholder={t("tag")} value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} />
          </div>
          <button
            onClick={async () => {
              try {
                await api("/guilds", { method: "POST", body: form });
                await reload();
              } catch (e) {
                setErr(te(e instanceof Error ? e.message : "No"));
              }
            }}
          >
            {t("foundCompany")}
          </button>
          {guilds.map((x) => (
            <div key={x.id} className="row" style={{ marginTop: 6 }}>
              <span>
                [{x.tag}] {x.name} ({x.members}) lv{x.level}
              </span>
              <button onClick={async () => { await api(`/guilds/${x.id}/join`, { method: "POST" }); reload(); }}>{t("join")}</button>
            </div>
          ))}
        </>
      )}
      <button style={{ marginTop: 8 }} onClick={onClose}>
        {t("back")}
      </button>
    </div>
  );
}
