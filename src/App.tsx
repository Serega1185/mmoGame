import { useCallback, useEffect, useRef, useState } from "react";
import { api, EQUIP_LAYOUT, type Item } from "./api";
import { InventoryGrid } from "./InventoryGrid";
import { ChatDock } from "./ChatDock";
import { HeroFace, HoverHint, ItemFace, ItemTooltip, SetTooltip, fmtStat, statEntries } from "./ui";
import { LangSwitcher, useI18n } from "./i18n";
import { BattleStage, applyAuraLine, auraFromStats, type BattleAura, type BattleFoe, type BattleFx } from "./BattleStage";
import { SET_MARK } from "./itemIcons";
import { ForgeView, putForgeSlot } from "./ForgeView";
import { AdminView } from "./AdminView";
import { LootPick } from "./LootPick";
import { TalentTree, type TalentTreeData } from "./TalentTree";
import { MarchMap, canFleeMarch, type MarchView } from "./MarchMap";
import { fetchStatus, rememberGate, type GateStatus } from "./gate";

const HIT_DELAY_MS = 1000;
const GATE_MS = 60_000;
const BEAT_KEYS = new Set(["combat.strike", "combat.dot", "combat.thorns", "combat.regen", "combat.leech"]);
const PREFIX_KEYS = new Set(["combat.crit", "combat.dodges", "combat.armor", "combat.barrier", "combat.chain"]);
const FOLLOWER_KEYS = new Set(["combat.poison", "combat.bleed", "combat.burn", "combat.freeze", "combat.skip"]);

function formatRefreshClock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function CityRefreshTimer({ at, onReady }: { at: number | null | undefined; onReady?: () => void }) {
  const { t } = useI18n();
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (!at || at <= Date.now()) return;
    const tick = window.setInterval(() => setNowTs(Date.now()), 1000);
    const wait = Math.max(0, at - Date.now());
    const done = window.setTimeout(() => {
      setNowTs(Date.now());
      onReady?.();
    }, wait + 80);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(done);
    };
  }, [at, onReady]);
  if (!at || at <= nowTs) return <span className="city-refresh-ready">{t("cityRefreshReady")}</span>;
  return <span className="city-refresh-wait">{formatRefreshClock(at - nowTs)}</span>;
}

type FightLogLine = { t: number; text: string; key?: string; vars?: Record<string, string | number> };

function takeFightClause(log: FightLogLine[], start: number) {
  let i = start;
  const lines: FightLogLine[] = [];
  while (i < log.length && PREFIX_KEYS.has(log[i]!.key || "")) {
    lines.push(log[i++]!);
  }
  if (i < log.length && BEAT_KEYS.has(log[i]!.key || "")) {
    lines.push(log[i++]!);
    while (i < log.length && FOLLOWER_KEYS.has(log[i]!.key || "")) {
      lines.push(log[i++]!);
    }
    return { lines, i, beat: true };
  }
  if (lines.length) return { lines, i, beat: false };
  if (i < log.length) lines.push(log[i++]!);
  return { lines, i, beat: false };
}

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
  xpNeed?: number;
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
  classIcon?: string;
  battleIcon?: string;
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

type CityInfo = {
  depth: number;
  name: string;
  level: number;
  treasury: number;
  taxPercent: number;
  shopLevel: number;
  ownerName: string | null;
  activity: number;
  art: string;
  unlocked: { depth: number; name: string; refreshAt?: number | null }[];
  roadOpen?: boolean;
  maxDepth?: number;
  depthCapped?: boolean;
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
  pendingFight?: BattleFoe[] | null;
  packOdds?: { two: number; three: number };
  city?: CityInfo | null;
};

function seedBattleAuras(stats: Record<string, number> | undefined, foes: BattleFoe[]): Record<string, BattleAura> {
  const map: Record<string, BattleAura> = { player: auraFromStats(stats) };
  for (const e of foes) map[String(e.id)] = auraFromStats(undefined, e.armor || 0);
  return map;
}

type Fight = {
  won: boolean;
  dead?: boolean;
  awaiting?: boolean;
  enemy: { name: string; kind: string; hp: number; id?: string; damage?: number; maxHp?: number; armor?: number; icon?: string };
  enemies?: BattleFoe[];
  log: { t: number; text: string; key?: string; vars?: Record<string, string | number> }[];
  gold?: number;
  loot?: Item[];
  xpGain?: number;
  level?: number;
  death?: Record<string, unknown>;
  playerHp: number;
  startPlayerHp?: number;
  playerMaxHp?: number;
  ore?: Item | null;
  campGold?: number;
};

type HallHero = {
  id: string;
  health: number;
  damage: number;
  armor: number;
  critChance: number;
  critDamage: number;
  dodge: number;
  lifesteal: number;
  luck: number;
  magicDamage: number;
  icon: string;
  portrait?: string;
  i18n: Record<string, { name: string; blurb: string }>;
};

function hallStartStats(h: HallHero) {
  return {
    health: h.health,
    damage: h.damage,
    armor: h.armor,
    critChance: h.critChance,
    critDamage: h.critDamage,
    dodge: h.dodge,
    lifesteal: h.lifesteal,
    luck: h.luck,
    magicDamage: h.magicDamage,
  };
}

const HALL_STAT_KEYS = ["health", "damage", "magicDamage", "armor", "critChance", "critDamage", "dodge", "lifesteal", "luck", "regen"] as const;

const FALLBACK_HALL: HallHero[] = [
  { id: "Ironclad", health: 140, damage: 12, armor: 8, critChance: 5, critDamage: 150, dodge: 3, lifesteal: 0, luck: 0, magicDamage: 0, icon: "", i18n: {} },
  { id: "Shadehand", health: 100, damage: 14, armor: 3, critChance: 12, critDamage: 175, dodge: 10, lifesteal: 4, luck: 0, magicDamage: 0, icon: "", i18n: {} },
  { id: "Thornbow", health: 110, damage: 13, armor: 4, critChance: 9, critDamage: 160, dodge: 7, lifesteal: 0, luck: 0, magicDamage: 0, icon: "", i18n: {} },
  { id: "Ashpriest", health: 95, damage: 8, armor: 3, critChance: 6, critDamage: 150, dodge: 5, lifesteal: 0, luck: 4, magicDamage: 14, icon: "", i18n: {} },
  { id: "Warden", health: 125, damage: 13, armor: 6, critChance: 7, critDamage: 155, dodge: 5, lifesteal: 2, luck: 0, magicDamage: 0, icon: "", i18n: {} },
];

export default function App() {
  const { t, te, itemName, setName, regionName, regionTheme, combatLine, heroName, heroBlurb } = useI18n();
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
  const [liveAuras, setLiveAuras] = useState<Record<string, BattleAura>>({});
  const [battleFx, setBattleFx] = useState<BattleFx | null>(null);
  const playingFight = useRef(false);
  const [foundOre, setFoundOre] = useState<Item | null>(null);
  const [foundCampGold, setFoundCampGold] = useState<number | null>(null);
  const [hoverOre, setHoverOre] = useState<{ item: Item; x: number; y: number } | null>(null);
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
  const [pickCity, setPickCity] = useState(false);
  const [hoverEq, setHoverEq] = useState<{ item: Item; x: number; y: number } | null>(null);
  const [hoverSet, setHoverSet] = useState<{
    set: Character["power"]["setBonuses"][number];
    x: number;
    y: number;
  } | null>(null);
  const [auth, setAuth] = useState({ email: "", password: "", username: "", tab: "login" as "login" | "register" | "forgot" });
  const [create, setCreate] = useState({ name: "", class: "Ironclad" });
  const [heroes, setHeroes] = useState<HallHero[]>([]);
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
    if (!user) return;
    if (game && game.character && !game.needCharacter) return;
    void api<{ heroes: HallHero[] }>("/catalog/heroes")
      .then((r) => {
        const list = r.heroes || [];
        setHeroes(list);
        setCreate((cur) => (list.some((h) => h.id === cur.class) || !list[0] ? cur : { ...cur, class: list[0].id }));
      })
      .catch(() => {});
  }, [user, game?.needCharacter, game?.character]);

  useEffect(() => {
    const foes = game?.pendingFight;
    const ch = game?.character;
    if (!foes?.length || !ch) return;
    if (playingFight.current) return;
    setFight({
      awaiting: true,
      won: false,
      enemy: foes[0]!,
      enemies: foes,
      log: [],
      playerHp: ch.hp,
      startPlayerHp: ch.hp,
      playerMaxHp: ch.power?.maxHp || ch.max_hp,
    });
    setLivePlayerHp(ch.hp);
    setLiveFoes(foes.map((e) => ({ ...e, hp: e.maxHp })));
    setLiveAuras(seedBattleAuras(ch.power?.stats, foes));
    setPlaybackDone(true);
  }, [game?.pendingFight, game?.character?.id]);

  useEffect(() => {
    const eq = game?.equipment;
    if (!eq) {
      setHoverEq(null);
      return;
    }
    setHoverEq((h) => (h && eq.some((e) => e.id === h.item.id) ? h : null));
  }, [game?.equipment]);

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

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const shopDepthRef = useRef(game?.city?.depth);
  shopDepthRef.current = game?.city?.depth;

  useEffect(() => {
    if (!ws) return;
    const onMsg = (ev: MessageEvent) => {
      let m: { type?: string; depth?: number };
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (m.type !== "shop") return;
      if (modeRef.current !== "shop") return;
      if (m.depth != null && shopDepthRef.current != null && Number(m.depth) !== Number(shopDepthRef.current)) return;
      api<Record<string, unknown>>("/shop")
        .then(setShop)
        .catch(() => {});
    };
    ws.addEventListener("message", onMsg);
    return () => ws.removeEventListener("message", onMsg);
  }, [ws]);

  useEffect(() => {
    logBox.current?.scrollTo({ top: logBox.current.scrollHeight, behavior: "smooth" });
  }, [logShown]);

  useEffect(() => {
    if (!fight || fight.awaiting) {
      if (!fight) {
        playingFight.current = false;
        setBattleFx(null);
        setLiveAuras({});
        setPlaybackDone(true);
      }
      return;
    }
    playingFight.current = true;
    let cancelled = false;
    const log = fight.log || [];
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
            armor: fight.enemy.armor || 0,
          },
        ]
    ).map((e) => ({ ...e, hp: e.maxHp }));
    let auras = seedBattleAuras(game?.character?.power?.stats, foes);
    setLivePlayerHp(pHp);
    setLiveFoes(foes);
    setLiveAuras(auras);
    setLogShown(0);
    setPlaybackDone(false);
    setBattleFx(null);
    let fxN = 0;
    (async () => {
      let i = 0;
      while (!cancelled && i < log.length) {
        const clause = takeFightClause(log, i);
        i = clause.i;
        let hit = false;
        let pendingCrit = false;
        let pendingSoak = 0;
        let pendingDodge = false;
        for (const line of clause.lines) {
          if (line.key === "combat.crit") pendingCrit = true;
          if (line.key === "combat.armor") pendingSoak = Number(line.vars?.n || 0);
          if (line.key === "combat.dodges") pendingDodge = true;
          auras = applyAuraLine(auras, line);
          if (line.key === "combat.strike") {
            const dealt = Number(line.vars?.dealt || 0);
            const soak = Number(line.vars?.soak ?? pendingSoak);
            pendingSoak = 0;
            const dodged = pendingDodge;
            pendingDodge = false;
            const def = String(line.vars?.defId || "");
            const att = String(line.vars?.attId || "");
            if (def === "player") pHp = Math.max(0, pHp - dealt);
            else foes = hurtFoe(foes, def, dealt);
            fxN += 1;
            setBattleFx({
              n: fxN,
              att,
              def,
              dealt: dodged ? 0 : dealt > 0 ? dealt : soak,
              blocked: !dodged && dealt <= 0 && soak > 0,
              dodge: dodged,
              crit: pendingCrit && !dodged,
            });
            pendingCrit = false;
            hit = true;
          } else if (line.key === "combat.dot") {
            const dmg = Number(line.vars?.dmg || 0);
            const soak = Number(line.vars?.soak || 0);
            const id = String(line.vars?.id || "");
            if (id === "player") pHp = Math.max(0, pHp - dmg);
            else foes = hurtFoe(foes, id, dmg);
            fxN += 1;
            setBattleFx({
              n: fxN,
              att: "",
              def: id,
              dealt: dmg > 0 ? dmg : soak,
              blocked: dmg <= 0 && soak > 0,
              dot: true,
            });
            hit = true;
          } else if (line.key === "combat.thorns") {
            const dmg = Number(line.vars?.dmg || 0);
            const att = String(line.vars?.attId || "");
            if (att === "player") pHp = Math.max(0, pHp - dmg);
            else foes = hurtFoe(foes, att, dmg);
            fxN += 1;
            setBattleFx({ n: fxN, att: String(line.vars?.def || ""), def: att, dealt: dmg, dot: true });
            hit = true;
          } else if (line.key === "combat.regen") {
            const hp = Number(line.vars?.hp || 0);
            const id = String(line.vars?.id || "");
            if (hp > 0) {
              if (id === "player") pHp = Math.min(cap, pHp + hp);
              else {
                foes = foes.map((f) =>
                  String(f.id) === id ? { ...f, hp: Math.min(f.maxHp, f.hp + hp) } : f
                );
              }
              fxN += 1;
              setBattleFx({ n: fxN, att: "", def: id, dealt: hp, heal: true });
              hit = true;
            }
          } else if (line.key === "combat.leech") {
            const ls = Number(line.vars?.ls || 0);
            const att = String(line.vars?.attId || "");
            if (ls > 0) {
              if (att === "player") pHp = Math.min(cap, pHp + ls);
              else {
                foes = foes.map((f) =>
                  String(f.id) === att ? { ...f, hp: Math.min(f.maxHp, f.hp + ls) } : f
                );
              }
              fxN += 1;
              setBattleFx({ n: fxN, att: "", def: att, dealt: ls, heal: true });
              hit = true;
            }
          }
        }
        setLiveAuras(auras);
        setLivePlayerHp(pHp);
        setLiveFoes(foes);
        setLogShown(i);
        if (clause.beat && hit && !cancelled) await new Promise((r) => setTimeout(r, HIT_DELAY_MS));
        if (!clause.lines.length) break;
      }
      if (!cancelled) {
        playingFight.current = false;
        if (!fight.dead) {
          try {
            await reload();
          } catch {
            /* keep the replay even if the ledger hiccups */
          }
          if (fight.ore && !fight.loot?.length) setFoundOre(fight.ore);
          if (fight.campGold && !fight.loot?.length) setFoundCampGold(fight.campGold);
        }
        setPlaybackDone(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fight?.log, fight?.awaiting]);

  async function linkItem(item: Item) {
    try {
      const d = await api<{ token: string; name: string; rarity?: string }>("/items/link", { method: "POST", body: { instanceId: item.id } });
      const rarity = d.rarity || item.rarity;
      setLinkQ(`[${d.name}](${d.token}${rarity ? `:${rarity}` : ""})`);
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
    const roster = heroes.length ? heroes : FALLBACK_HALL;
    const picked = roster.find((h) => h.id === create.class) || roster[0];
    const startStats = picked ? hallStartStats(picked) : {};
    return (
      <div className="auth-screen">
        <div className="lang-bar">
          <LangSwitcher />
        </div>
        <div className="panel auth-card hall-card">
          <h2>{t("newWayfarer")}</h2>
          <p className="muted">{t("newWayfarerHint")}</p>
          <div className="hall-portraits">
            {roster.map((h) => (
              <button
                key={h.id}
                type="button"
                className={`hall-slot${create.class === h.id ? " on" : ""}`}
                onClick={() => setCreate({ ...create, class: h.id })}
                title={heroName(h.id)}
              >
                <HeroFace icon={h.portrait || h.icon} alt={heroName(h.id)} />
              </button>
            ))}
          </div>
          {picked ? (
            <div className="hall-sheet">
              <div className="hall-art">
                <HeroFace icon={picked.icon || picked.portrait} alt={heroName(picked.id)} />
              </div>
              <div>
                <div className="hall-name">{heroName(picked.id)}</div>
                <p className="muted hall-blurb">{heroBlurb(picked.id)}</p>
                <ul className="hall-stats">
                  {HALL_STAT_KEYS.filter((k) => startStats[k]).map((k) => (
                    <li key={k}>
                      <span>{t(`stat_${k}`)}</span>
                      <b>
                        {Math.round((startStats[k] || 0) * 10) / 10}
                        {k === "critChance" || k === "dodge" || k === "lifesteal" || k === "luck" ? "%" : ""}
                        {k === "critDamage" ? "%" : ""}
                      </b>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
          <label>{t("name")}</label>
          <input value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} />
          <div className="hall-actions">
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
            <button
              onClick={async () => {
                await api("/auth/logout", { method: "POST" });
                setUser(null);
              }}
            >
              {t("leaveHall")}
            </button>
            {user.role === "admin" ? (
              <button onClick={() => setMode("admin")}>{t("seneschalHall")}</button>
            ) : null}
          </div>
          {err ? <div className="error">{err}</div> : null}
        </div>
      </div>
    );
  }

  const c = game.character;
  const maxHp = c.power.maxHp || c.max_hp;
  const inCity = c.location === "CITY";
  const stats = c.power.stats;
  const displayHp = Math.min(
    fight && !playbackDone ? livePlayerHp : c.hp,
    fight && !playbackDone ? fight.playerMaxHp ?? maxHp : maxHp
  );
  const xpNeed = Math.max(1, c.xpNeed || Math.max(1, c.level));
  const waitingReplay = !!(fight && !fight.awaiting && !playbackDone);
  const lootOffers = waitingReplay ? [] : game.lootChoices || [];
  const awaiting = !!(fight?.awaiting && !fight.dead);
  const showArena = !!(fight && (fight.awaiting || !playbackDone));
  const showLastLog = !!(showArena && fight.log?.length);
  const march = game.march;
  const roadShown = mobile === "fight" || (typeof window !== "undefined" && window.innerWidth > 1100);

  async function startFight() {
    try {
      const startPlayerHp = c.hp;
      const playerMaxHp = maxHp;
      const r = await api<Fight>("/game/fight", { method: "POST" });
      const packed: Fight = { ...r, awaiting: false, startPlayerHp, playerMaxHp };
      playingFight.current = true;
      setPlaybackDone(false);
      setLivePlayerHp(startPlayerHp);
      setLiveFoes(
        (packed.enemies?.length
          ? packed.enemies
          : [
              {
                id: packed.enemy.id,
                name: packed.enemy.name,
                kind: packed.enemy.kind,
                hp: packed.enemy.maxHp || packed.enemy.hp,
                maxHp: packed.enemy.maxHp || packed.enemy.hp,
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

  async function fleeFight() {
    if (!march || !canFleeMarch(march)) return;
    try {
      await api("/game/flee", { method: "POST" });
      playingFight.current = false;
      setFight(null);
      setLiveFoes([]);
      setPlaybackDone(true);
      await reload();
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "The road refuses"));
    }
  }

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
      if (r.action === "loot" || (r.action !== "ambush" && r.action !== "fight" && !r.enemy)) {
        setFight(null);
        await reload();
        return;
      }
      const packed: Fight = {
        ...r,
        awaiting: r.action === "ambush",
        startPlayerHp,
        playerMaxHp,
        log: r.action === "ambush" ? [] : r.log,
        won: r.action === "ambush" ? false : r.won,
      };
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
      await reload();
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
              <b>{d.character}</b> {heroName(String(d.class), String(d.class))}
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
          <div className="hero-portrait">
            <HeroFace icon={c.classIcon} alt={c.name} />
          </div>
          <div>
            <div className="hero-name">{c.name}</div>
            <div className="muted hero-class">
              {heroName(c.class, c.class)} · {c.level}
            </div>
          </div>
        </div>
        <div className="statpills">
          <span className="pill pill-coins">
            {t("crowns")} <b>{game.user.coins}</b>
            <span className="coin-ico" aria-hidden />
          </span>
          <span className="pill">{t("roundOf", { round: c.round })}</span>
          <span className="pill">{t("depthOf", { n: c.depth || 1 })}</span>
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
        <aside className={`panel left-panel${lootOffers.length ? " loot-peek" : ""}`} style={{ display: mobile === "equip" || window.innerWidth > 1100 ? "block" : "none" }}>
              <div className="section-title">{t("characterLabel")}</div>
              <div className="hero-vitals">
                <div className="hero-level" title={t("levelReached", { level: c.level })}>
                  <span>{t("lvl")}</span>
                  <b>{c.level}</b>
                </div>
                <div className="hero-bars">
                  <div className="hpbar hero wide">
                    <span style={{ width: `${(displayHp / Math.max(1, maxHp)) * 100}%` }} />
                    <em>
                      {displayHp}/{maxHp}
                    </em>
                    <div className="armor-badge" title={t("stat_armor")}>
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="rgba(22,14,10,0.88)" stroke="#c8c4bc" strokeWidth="1.6">
                        <path d="M12 3 L20 6 V12 C20 17 12 21 12 21 C12 21 4 17 4 12 V6 Z" />
                      </svg>
                      <b>{Math.round(stats.armor || 0)}</b>
                    </div>
                  </div>
                  <div className="xpbar" title={t("xpBar", { cur: c.xp, need: xpNeed })}>
                    <span style={{ width: `${(c.xp / Math.max(1, xpNeed)) * 100}%` }} />
                    <em>
                      {c.xp}/{xpNeed}
                    </em>
                  </div>
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
                        onMouseEnter={(e) => (it ? setHoverEq({ item: it, x: e.clientX, y: e.clientY }) : setHoverEq(null))}
                        onMouseMove={(e) => (it ? setHoverEq({ item: it, x: e.clientX, y: e.clientY }) : setHoverEq(null))}
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
                    if (mode === "forge" && it.definition.category !== "ore") setForgeSlots(putForgeSlot(forgeSlots, it.id));
                  }}
                />
                <img className="pack-flourish" src="/assets/ui/filigree-center.svg" alt="" />
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
          <div className="panel-version">{gate?.version || "1.0.0"}</div>
        </aside>

        <main>
          {mode === "storage" && game.storage ? (
            <div className="panel center-pane stall-pane">
              <div className="stall-head">
                <div className="stall-head-ico" aria-hidden>
                  ♜
                </div>
                <div className="stall-head-copy">
                  <h2>{t("vaultTitle", { level: game.storage.level, cells: game.storage.cells })}</h2>
                  <p>{t("vaultHint")}</p>
                </div>
              </div>
              <div className="vault-grid-wrap">
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
              </div>
              <div className="stall-actions">
                <button
                  type="button"
                  className="stall-act"
                  onClick={async () => {
                    await api("/storage/upgrade", { method: "POST" });
                    reload();
                  }}
                >
                  <span>{t("enlargeAction")}</span>
                  <em>{game.storage.upgradeCost}</em>
                </button>
                <button type="button" className="stall-act ghost" onClick={() => setMode("city")}>
                  <span>{t("backSquare")}</span>
                </button>
              </div>
            </div>
          ) : mode === "shop" && shop ? (
            <ShopView
              shop={shop}
              coins={game.user.coins}
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
              userId={game.user.id}
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
              <div className="city-head">
                <h2>{t("townSquare")}</h2>
                <button onClick={() => setPickCity(true)}>{t("changeCity")}</button>
              </div>
              <div className="city-hero">
                <div className="city-art-wrap">
                  <img className="city-art" src={game.city?.art || "/assets/art/gorod1.jpg"} alt="" />
                </div>
                <div className="city-hero-side">
                  <h3>{regionName(game.city?.depth || c.depth, game.city?.name)}</h3>
                  <p className="city-safe">{t("citySafeZone")}</p>
                  <div className="city-stats">
                    <HoverHint className="city-stat" title={t("cityLevel")} text={t("cityLevelTip")}>
                      <div className="city-stat-ico">◆</div>
                      <div className="city-stat-body">
                        <div className="city-stat-val">{game.city?.level ?? 1}</div>
                        <div className="city-stat-lab">{t("cityLevel")}</div>
                      </div>
                    </HoverHint>
                    <HoverHint className="city-stat" title={t("cityActivity")} text={t("cityActivityTip")}>
                      <div className="city-stat-ico">☉</div>
                      <div className="city-stat-body">
                        <div className="city-stat-val">{game.city?.activity ?? 0}</div>
                        <div className="city-stat-lab">{t("cityActivity")}</div>
                      </div>
                    </HoverHint>
                    <HoverHint className="city-stat" title={t("cityTreasury")} text={t("cityTreasuryTip")}>
                      <div className="city-stat-ico">⚜</div>
                      <div className="city-stat-body">
                        <div className="city-stat-val">{game.city?.treasury ?? 0}</div>
                        <div className="city-stat-lab">{t("cityTreasury")}</div>
                      </div>
                    </HoverHint>
                    <HoverHint className="city-stat" title={t("cityTax")} text={t("cityTaxTip")}>
                      <div className="city-stat-ico">%</div>
                      <div className="city-stat-body">
                        <div className="city-stat-val">{game.city?.taxPercent ?? 0}%</div>
                        <div className="city-stat-lab">{t("cityTax")}</div>
                      </div>
                    </HoverHint>
                  </div>
                </div>
              </div>
              <div className="city-ruler">
                {t("cityRuler", { name: game.city?.ownerName || t("absent") })}
              </div>
              <div className="city-builds-title">{t("cityBuildings")}</div>
              <p className="muted city-builds-hint">{t("cityBuildingsHint")}</p>
              <div className="city-builds">
                <CityBuildCard
                  kind="vault"
                  icon="♜"
                  name={t("vault")}
                  stat={t("buildStat_vault", { n: game.storage?.cells ?? 20 + (game.user.storage_level - 1) * 10 })}
                  desc={t("vaultDesc")}
                  tag={t("buildLv", { n: game.user.storage_level })}
                  onClick={() => setMode("storage")}
                />
                <CityBuildCard
                  kind="forge"
                  icon="⚒"
                  name={t("forge")}
                  stat={t("buildStat_forge")}
                  desc={t("forgeDesc")}
                  tag={t("buildTag_craft")}
                  onClick={() => {
                    setForgeSlots([null, null, null]);
                    setMode("forge");
                  }}
                />
                <CityBuildCard
                  kind="shop"
                  icon="⚖"
                  name={t("stall")}
                  stat={t("buildStat_shop", { n: game.city?.taxPercent ?? 0 })}
                  desc={t("stallDesc")}
                  tag={t("buildLv", { n: game.city?.shopLevel ?? 1 })}
                  onClick={async () => {
                    setMode("shop");
                    setShop(await api("/shop"));
                  }}
                />
                <CityBuildCard
                  kind="auction"
                  icon="⚔"
                  name={t("crierBoard")}
                  stat={t("buildStat_auction")}
                  desc={t("crierDesc")}
                  tag={t("buildTag_global")}
                  onClick={async () => {
                    setMode("auction");
                    setAuction(await api("/auction"));
                  }}
                />
                <CityBuildCard
                  kind="guild"
                  icon="🛡"
                  name={t("companyHall")}
                  stat={t("buildStat_guild")}
                  desc={t("companyDesc")}
                  tag={t("buildTag_guild")}
                  onClick={async () => {
                    setMode("guild");
                    setGuilds(await api("/guilds"));
                    setMyGuild(await api("/guild"));
                  }}
                />
              </div>
              <div className="city-leave">
                {game.city?.roadOpen === false && !game.city?.depthCapped ? (
                  <p className="muted">
                    {t("continueMarchWait")}{" "}
                    <CityRefreshTimer
                      at={game.city.unlocked?.find((u) => u.depth === game.city?.depth)?.refreshAt}
                      onReady={() => void reload()}
                    />
                  </p>
                ) : null}
                {game.city?.depthCapped ? (
                  <HoverHint as="span" className="city-leave-tip" text={t("maxDepthReached")}>
                    <button type="button" className="danger" disabled>
                      {t("continueMarch")}
                    </button>
                  </HoverHint>
                ) : (
                  <button
                    className="danger"
                    disabled={game.city?.roadOpen === false}
                    onClick={async () => {
                      try {
                        await api("/game/leave-city", { method: "POST" });
                        setMode("play");
                        setFight(null);
                        setPickCity(false);
                        await reload();
                      } catch (e) {
                        setErr(te(e instanceof Error ? e.message : "The gate is shut"));
                      }
                    }}
                  >
                    {t("continueMarch")}
                  </button>
                )}
              </div>
              {pickCity ? (
                <div className="modal-back" onClick={() => setPickCity(false)}>
                  <div className="panel modal" onClick={(e) => e.stopPropagation()}>
                    <h3>{t("changeCity")}</h3>
                    <div className="city-pick-list">
                      {(game.city?.unlocked || [{ depth: c.depth, name: game.city?.name || "", refreshAt: null }]).map((u) => (
                        <button
                          key={u.depth}
                          className={`city-pick-row${u.depth === game.city?.depth ? " gold" : ""}`}
                          onClick={async () => {
                            try {
                              await api("/city/switch", { method: "POST", body: { depth: u.depth } });
                              setPickCity(false);
                              await reload();
                            } catch (e) {
                              setErr(te(e instanceof Error ? e.message : "The gate is shut"));
                            }
                          }}
                        >
                          <span>
                            {t("depthOf", { n: u.depth })} · {regionName(u.depth, u.name)}
                          </span>
                          <CityRefreshTimer at={u.refreshAt} onReady={() => void reload()} />
                        </button>
                      ))}
                    </div>
                    <button style={{ marginTop: 10 }} onClick={() => setPickCity(false)}>
                      {t("back")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className={`panel battle-wrap${showArena && !awaiting ? " live" : ""}`} style={{ display: roadShown ? "flex" : "none" }}>
              {showArena ? (
                <div className="arena-block">
                  {awaiting ? (
                    <div className="start-fight-overlay">
                      <div className="start-fight-actions">
                        <button className="gold start-fight-btn" onClick={() => void startFight()}>
                          {t("startFight")}
                        </button>
                        {march && !canFleeMarch(march) ? (
                          <span className="flee-tip-wrap">
                            <button type="button" className="start-fight-btn flee-locked" disabled>
                              {t("flee")}
                            </button>
                            <span className="flee-only-tip parchment">{t("fleeOnlyPath")}</span>
                          </span>
                        ) : (
                          <button type="button" className="danger start-fight-btn" onClick={() => void fleeFight()}>
                            {t("flee")}
                          </button>
                        )}
                      </div>
                    </div>
                  ) : null}
                  <BattleStage
                    playerName={c.name}
                    playerIcon={c.battleIcon || c.classIcon}
                    playerHp={livePlayerHp}
                    playerMax={fight?.playerMaxHp ?? maxHp}
                    playerDamage={Math.max(
                      1,
                      Math.round(
                        (stats.magicDamage || 0) > (stats.damage || 0) ? stats.magicDamage || 0 : stats.damage || 0
                      )
                    )}
                    playerAura={liveAuras.player}
                    foeAuras={liveAuras}
                    foes={liveFoes}
                    inCity={false}
                    fx={awaiting ? null : battleFx}
                  />
                </div>
              ) : march ? (
                <MarchMap
                  march={march}
                  packTwo={game.packOdds?.two ?? 10}
                  packThree={game.packOdds?.three ?? 1}
                  interactive={!inCity && !lootOffers.length && !awaiting}
                  onPick={travelTo}
                />
              ) : (
                <p className="muted">{t("mapHint")}</p>
              )}
                  {(fight?.won && playbackDone && !awaiting) ? (
                    <p className="muted last-spoils">{t("spoils", { xp: fight.xpGain ?? 0 })}</p>
                  ) : null}
              {showLastLog ? (
                <div className="log" ref={logBox}>
                  {(fight?.log || []).slice(0, playbackDone || awaiting ? fight!.log.length : logShown).map((l, i) => (
                    <div key={i} className={l.key === "combat.crit" ? "crit" : l.key === "combat.falls" || l.key === "combat.fallen" ? "fall" : l.key === "combat.bleed" || l.key === "combat.poison" || l.key === "combat.burn" || l.key === "combat.freeze" || l.key === "combat.dot" || l.key === "combat.thorns" || l.key === "combat.barrier" ? "dot" : ""}>
                      {combatLine(l)}
                    </div>
                  ))}
                </div>
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
          <img className="pack-flourish" src="/assets/ui/filigree-center.svg" alt="" />
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
              interactive={!inCity && !lootOffers.length && !showArena}
              packTwo={game.packOdds?.two ?? 10}
              packThree={game.packOdds?.three ?? 1}
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
          log={fight?.log}
          xpGain={fight?.xpGain}
          campGold={fight?.campGold}
          setErr={setErr}
          onDone={async (ore, campGold) => {
            await reload();
            if (ore) setFoundOre(ore);
            if (campGold && !fight?.campGold) setFoundCampGold(campGold);
          }}
        />
      ) : null}

      {foundOre ? (
        <div className="loot-pick-back">
          <div className="panel loot-pick loot-pick-ore">
            <div className="loot-pick-banner">{t("foundOreTitle")}</div>
            <p className="muted loot-pick-hint">{t("foundOreHint")}</p>
            <div className="loot-pick-row">
              <div
                className="loot-pick-card"
                onMouseEnter={(e) => setHoverOre({ item: foundOre, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => setHoverOre({ item: foundOre, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHoverOre(null)}
              >
                <div className={`cell has-item filled r-${foundOre.rarity} loot-pick-cell`}>
                  <ItemFace item={foundOre} />
                </div>
                <div className={`loot-pick-name r-${foundOre.rarity}`}>{itemName(foundOre)}</div>
                <div className="muted">{t(`rarity_${foundOre.rarity}`)}</div>
              </div>
            </div>
            <button
              className="gold"
              onClick={() => {
                setHoverOre(null);
                setFoundOre(null);
              }}
            >
              {t("foundOreTake")}
            </button>
          </div>
          {hoverOre ? <ItemTooltip item={hoverOre.item} x={hoverOre.x} y={hoverOre.y} charLevel={c.level} /> : null}
        </div>
      ) : null}

      {foundCampGold ? (
        <div className="loot-pick-back">
          <div className="panel loot-pick loot-pick-ore">
            <div className="loot-pick-banner">{t("foundCampTitle")}</div>
            <p className="muted loot-pick-hint">{t("foundCampHint")}</p>
            <div className="loot-pick-camp-gold">{t("foundCampAmount", { n: foundCampGold })}</div>
            <button className="gold" onClick={() => setFoundCampGold(null)}>
              {t("foundCampTake")}
            </button>
          </div>
        </div>
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

const STALL_TIERS: { id: string; rarities: string[]; label: string }[] = [
  { id: "common", rarities: ["Common"], label: "rarity_Common" },
  { id: "uncommon", rarities: ["Uncommon"], label: "rarity_Uncommon" },
  { id: "rare", rarities: ["Rare"], label: "rarity_Rare" },
  { id: "epic", rarities: ["Epic"], label: "rarity_Epic" },
];

function CityBuildCard({
  kind,
  icon,
  name,
  stat,
  desc,
  tag,
  onClick,
}: {
  kind: "vault" | "forge" | "shop" | "auction" | "guild";
  icon: string;
  name: string;
  stat: string;
  desc: string;
  tag: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`city-bcard k-${kind}`} onClick={onClick}>
      <div className="city-bcard-ico" aria-hidden>
        {icon}
      </div>
      <div className="city-bcard-body">
        <div className="city-bcard-name">{name}</div>
        <div className="city-bcard-stat">{stat}</div>
        <div className="city-bcard-desc">{desc}</div>
      </div>
      <span className="city-bcard-tag">{tag}</span>
    </button>
  );
}

function fmtRestock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function ShopView({
  shop,
  coins,
  charLevel,
  onClose,
  reload,
  setErr,
}: {
  shop: Record<string, unknown>;
  coins: number;
  charLevel?: number;
  onClose: () => void;
  reload: () => Promise<void>;
  setErr: (s: string) => void;
}) {
  const { t, te, itemName } = useI18n();
  const items = (shop.items as { id: string; price: number; item: Item }[]) || [];
  const canManage = !!shop.canManage;
  const restockAt = Number(shop.restockAt) || 0;
  const [hover, setHover] = useState<{ item: Item; x: number; y: number } | null>(null);
  const [left, setLeft] = useState(() => Math.max(0, restockAt - Date.now()));

  useEffect(() => {
    const tick = () => setLeft(Math.max(0, restockAt - Date.now()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [restockAt]);

  useEffect(() => {
    if (!restockAt || left > 0) return;
    const id = window.setTimeout(() => {
      reload().catch(() => {});
    }, 400);
    return () => window.clearTimeout(id);
  }, [left, restockAt, reload]);

  async function buy(id: string) {
    try {
      await api("/shop/buy", { method: "POST", body: { id } });
      await reload();
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "No"));
    }
  }

  return (
    <div className="panel center-pane stall-pane">
      <div className="stall-head">
        <div className="stall-head-ico" aria-hidden>
          ⚖
        </div>
        <div className="stall-head-copy">
          <h2>{t("stallTitle", { level: String(shop.level) })}</h2>
          <p>
            {t("stallHint", { tax: Number(shop.taxPercent) || 0 })}{" "}
            <span className="stall-coins">({t("stallCoinsOnHand", { n: coins })})</span>
          </p>
          {restockAt ? <p className="stall-timer">{t("stallRestockIn", { t: fmtRestock(left) })}</p> : null}
        </div>
      </div>
      <div className="stall-cols">
        {STALL_TIERS.map((tier) => {
          const rows = items.filter((s) => {
            if (tier.rarities.includes(s.item.rarity)) return true;
            return tier.id === "epic" && (s.item.rarity === "Legendary" || s.item.rarity === "Mythic");
          });
          return (
            <div key={tier.id} className={`stall-col r-${tier.id}`}>
              <div className="stall-col-head">{t(tier.label)}</div>
              <div className="stall-col-list">
                {rows.length === 0 ? <div className="stall-empty">{t("stallEmpty")}</div> : null}
                {rows.map((s) => (
                  <div key={s.id} className={`stall-card r-${s.item.rarity}`}>
                    <div
                      className={`cell has-item r-${s.item.rarity} stall-slot`}
                      onMouseEnter={(e) => setHover({ item: s.item, x: e.clientX, y: e.clientY })}
                      onMouseMove={(e) => setHover({ item: s.item, x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => setHover(null)}
                    >
                      <ItemFace item={s.item} />
                    </div>
                    <div className="stall-card-copy">
                      <b>{itemName(s.item)}</b>
                      <div className="muted">
                        {t(`rarity_${s.item.rarity}`)} · {t("itemReqShort", { n: s.item.required_level })}
                      </div>
                    </div>
                    <button type="button" className="stall-buy" onClick={() => void buy(s.id)}>
                      <span className="stall-buy-qty">{t("stallBuyQty")}</span>
                      <span className="stall-buy-price">{s.price}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {hover ? <ItemTooltip item={hover.item} x={hover.x} y={hover.y} charLevel={charLevel} /> : null}
      <div className="stall-actions">
        <HoverHint as="span" title={t("refreshAction")} text={t("stallTipRefresh")}>
          <button
            type="button"
            className="stall-act"
            disabled={!canManage}
            onClick={async () => {
              try {
                await api("/shop/refresh", { method: "POST" });
                await reload();
              } catch (e) {
                setErr(te(e instanceof Error ? e.message : "No"));
              }
            }}
          >
            <span>{t("refreshAction")}</span>
            <em>{shop.refreshCost}</em>
          </button>
        </HoverHint>
        <HoverHint as="span" title={t("widenAction")} text={t("stallTipWiden")}>
          <button
            type="button"
            className="stall-act"
            disabled={!canManage}
            onClick={async () => {
              try {
                await api("/shop/upgrade", { method: "POST" });
                await reload();
              } catch (e) {
                setErr(te(e instanceof Error ? e.message : "No"));
              }
            }}
          >
            <span>{t("widenAction")}</span>
            <em>{shop.upgradeCost}</em>
          </button>
        </HoverHint>
        <button type="button" className="stall-act ghost" onClick={onClose}>
          <span>{t("back")}</span>
        </button>
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
    <div className="panel center-pane stall-pane">
      <div className="stall-head">
        <div className="stall-head-ico" aria-hidden>
          ⚔
        </div>
        <div className="stall-head-copy">
          <h2>{t("boardTitle", { cap: String(data.cap) })}</h2>
          <p>{t("boardFees", { fee12: (Number(data.fee12) * 100).toFixed(0), fee24: (Number(data.fee24) * 100).toFixed(0) })}</p>
        </div>
      </div>
      <div className="board-post">
        <div className="board-post-label">{t("boardPost")}</div>
        <div className="board-post-row">
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            {pack.map((p) => (
              <option key={p.id} value={p.id}>
                {itemName(p)}
              </option>
            ))}
          </select>
          <input value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 100 }} />
          <button type="button" className={hours === 12 ? "gold" : ""} onClick={() => setHours(12)}>
            12h
          </button>
          <button type="button" className={hours === 24 ? "gold" : ""} onClick={() => setHours(24)}>
            24h
          </button>
          <button
            type="button"
            className="stall-act"
            onClick={async () => {
              try {
                await onList(pick);
              } catch (e) {
                setErr(te(e instanceof Error ? e.message : "No"));
              }
            }}
          >
            <span>{t("nailIt", { hours })}</span>
          </button>
        </div>
      </div>
      <div className="board-list">
        {listings.length === 0 ? <div className="stall-empty">{t("boardEmpty")}</div> : null}
        {listings.map((l) => (
          <div key={l.id} className={`stall-card r-${l.item.rarity}`}>
            <div
              className={`cell has-item r-${l.item.rarity} stall-slot`}
              onMouseEnter={(e) => setHover({ item: l.item, x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => setHover({ item: l.item, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setHover(null)}
            >
              <ItemFace item={l.item} />
            </div>
            <div className="stall-card-copy">
              <b>{itemName(l.item)}</b>
              <div className="muted">
                {t(`rarity_${l.item.rarity}`)} · {l.seller_name} · {Math.max(0, Math.round((l.expires_at - Date.now()) / 60000))}m
              </div>
            </div>
            <button
              type="button"
              className="stall-buy"
              onClick={async () => {
                try {
                  await onBuy(l.id);
                } catch (e) {
                  setErr(te(e instanceof Error ? e.message : "No"));
                }
              }}
            >
              <span className="stall-buy-qty">{t("buyAction")}</span>
              <span className="stall-buy-price">{l.price}</span>
            </button>
          </div>
        ))}
      </div>
      {hover ? <ItemTooltip item={hover.item} x={hover.x} y={hover.y} charLevel={charLevel} /> : null}
      <div className="stall-actions">
        <button type="button" className="stall-act ghost" onClick={onClose}>
          <span>{t("back")}</span>
        </button>
      </div>
    </div>
  );
}

type GuildMember = {
  rank: string;
  joined_at: number;
  username: string;
  id: string;
  character_name: string | null;
  character_level: number | null;
  character_class: string | null;
};

type PublicGuild = {
  id: string;
  name: string;
  tag: string;
  description: string;
  emblem: string;
  level: number;
  leader_user_id: string;
  created_at: number;
  roster?: GuildMember[];
  memberCount?: number;
  members: number;
  cap: number;
  leaderName: string;
  upgradeCost: number;
};

const GUILD_EMBLEMS = ["wolf", "raven", "oak", "sword", "crown", "stag"] as const;
const EMBLEM_MARK: Record<string, string> = {
  wolf: "🐺",
  raven: "✦",
  oak: "❖",
  sword: "⚔",
  crown: "♔",
  stag: "♜",
};

function emblemMark(id: string) {
  return EMBLEM_MARK[id] || "🛡";
}

function fmtDay(ts: number) {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

function GuildView({
  list,
  mine,
  userId,
  reload,
  onClose,
  setErr,
}: {
  list: Record<string, unknown> | null;
  mine: Record<string, unknown> | null;
  userId: string;
  reload: () => Promise<void>;
  onClose: () => void;
  setErr: (s: string) => void;
}) {
  const { t, te, heroName } = useI18n();
  const [form, setForm] = useState({ name: "", tag: "", description: "", emblem: "wolf" });
  const [pick, setPick] = useState<string | null>(null);
  const guilds = (list?.guilds as PublicGuild[]) || [];
  const mineId = (mine?.guild as { id?: string } | null)?.id || null;
  const selected = guilds.find((g) => g.id === pick) || guilds[0] || null;

  useEffect(() => {
    if (!guilds.length) {
      if (pick) setPick(null);
      return;
    }
    if (pick && guilds.some((g) => g.id === pick)) return;
    setPick(guilds[0]!.id);
  }, [guilds, pick]);

  const roster = selected?.roster || [];
  const count = selected ? selected.memberCount ?? selected.members ?? roster.length : 0;
  const cap = selected?.cap || 0;
  const full = cap > 0 && count >= cap;
  const inSelected = !!(selected && mineId === selected.id);
  const isLeader = !!(selected && selected.leader_user_id === userId);
  const canJoin = !!selected && !mineId && !full;

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      await reload();
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "No"));
    }
  }

  return (
    <div className="panel center-pane stall-pane guild-hall">
      <div className="stall-head">
        <div className="stall-head-ico" aria-hidden>
          🛡
        </div>
        <div className="stall-head-copy">
          <h2>{t("hallTitle")}</h2>
          <p>{t("guildHint")}</p>
        </div>
      </div>
      <div className="guild-split">
        <aside className="guild-rail">
          <div className="guild-rail-head">{t("guildList")}</div>
          <div className="guild-rail-list">
            {guilds.length === 0 ? <div className="stall-empty">{t("guildEmpty")}</div> : null}
            {guilds.map((g) => {
              const n = g.memberCount ?? g.members ?? g.roster?.length ?? 0;
              const on = selected?.id === g.id;
              const yours = mineId === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  className={`guild-row${on ? " on" : ""}${yours ? " yours" : ""}`}
                  onClick={() => setPick(g.id)}
                >
                  <div className="guild-row-ico" aria-hidden>
                    {emblemMark(g.emblem)}
                  </div>
                  <div className="guild-row-body">
                    <div className="guild-row-name">
                      [{g.tag}] {g.name}
                    </div>
                    <div className="guild-row-stat">
                      {t("roster", { n: String(n), cap: String(g.cap) })}
                    </div>
                    <div className="guild-row-meta">{t("hallLv", { level: g.level })}</div>
                  </div>
                  {yours ? <span className="guild-row-mark">{t("guildYours")}</span> : null}
                </button>
              );
            })}
          </div>
        </aside>
        <section className="guild-sheet">
          {selected ? (
            <>
              <div className="guild-sheet-top">
                <div className="guild-sheet-ico" aria-hidden>
                  {emblemMark(selected.emblem)}
                </div>
                <div className="guild-sheet-title">
                  <div className="guild-sheet-name">
                    [{selected.tag}] {selected.name}
                  </div>
                  <div className="guild-sheet-flags">
                    {inSelected ? <span className="guild-flag yours">{t("guildYours")}</span> : null}
                    <span className={`guild-flag ${full ? "full" : "open"}`}>{full ? t("guildFull") : t("guildOpen")}</span>
                    <span className="guild-flag">{t(`guildEmblem_${selected.emblem}`) || selected.emblem}</span>
                  </div>
                </div>
              </div>
              <p className="guild-desc">{selected.description?.trim() || t("guildNoDesc")}</p>
              <div className="guild-facts">
                <div className="guild-fact">
                  <div className="guild-fact-lab">{t("guildLeader")}</div>
                  <div className="guild-fact-val">{selected.leaderName || "—"}</div>
                </div>
                <div className="guild-fact">
                  <div className="guild-fact-lab">{t("guildMembersTitle")}</div>
                  <div className="guild-fact-val">
                    {count} / {cap}
                  </div>
                </div>
                <div className="guild-fact">
                  <div className="guild-fact-lab">{t("guildHall")}</div>
                  <div className="guild-fact-val">{selected.level}</div>
                </div>
                <div className="guild-fact">
                  <div className="guild-fact-lab">{t("guildFounded")}</div>
                  <div className="guild-fact-val">{fmtDay(selected.created_at)}</div>
                </div>
              </div>
              <p className="muted guild-seats">{t("guildSeats", { free: Math.max(0, cap - count) })}</p>
              <div className="guild-roster-head">{t("guildMembersTitle")}</div>
              <div className="guild-roster">
                {roster.length === 0 ? <div className="stall-empty">{t("guildEmpty")}</div> : null}
                {roster.map((m) => {
                  const cls = m.character_class ? heroName(m.character_class) : "";
                  return (
                    <div key={m.id} className={`guild-member${m.id === userId ? " me" : ""}${m.rank === "leader" ? " lead" : ""}`}>
                      <span className={`guild-rank r-${m.rank}`}>{t(`guildRank_${m.rank}`) || m.rank}</span>
                      <div className="guild-member-body">
                        <b>
                          {m.username}
                          {m.id === userId ? <em> · {t("guildYou")}</em> : null}
                        </b>
                        <span>
                          {m.character_name
                            ? `${m.character_name}${cls ? ` · ${cls}` : ""}${m.character_level != null ? ` · ${t("itemReqShort", { n: m.character_level })}` : ""}`
                            : t("guildNoChar")}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="guild-acts">
                {canJoin ? (
                  <button type="button" className="stall-act" onClick={() => void act(() => api(`/guilds/${selected.id}/join`, { method: "POST" }))}>
                    <span>{t("join")}</span>
                  </button>
                ) : null}
                {inSelected && isLeader ? (
                  <button type="button" className="stall-act" onClick={() => void act(() => api("/guild/upgrade", { method: "POST" }))}>
                    <span>{t("raiseWalls", { cost: String(selected.upgradeCost) })}</span>
                  </button>
                ) : null}
                {inSelected ? (
                  <button type="button" className="stall-act danger" onClick={() => void act(() => api("/guild/leave", { method: "POST" }))}>
                    <span>{t("leaveBanner")}</span>
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <div className="stall-empty">{t("guildEmpty")}</div>
          )}
        </section>
      </div>
      {!mineId && list ? (
        <div className="guild-found">
          <div className="guild-found-head">{t("guildFoundTitle")}</div>
          <p className="muted">{t("foundingHint", { region: String(list?.requiredRegion ?? ""), cost: String(list?.cost ?? "") })}</p>
          <div className="guild-found-row">
            <input placeholder={t("name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input
              className="guild-tag"
              placeholder={t("tag")}
              value={form.tag}
              onChange={(e) => setForm({ ...form, tag: e.target.value.toUpperCase() })}
              maxLength={5}
            />
          </div>
          <textarea
            className="guild-found-desc"
            placeholder={t("guildDesc")}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            maxLength={280}
          />
          <div className="guild-emblems" role="group" aria-label={t("guildEmblem")}>
            {GUILD_EMBLEMS.map((id) => (
              <button
                key={id}
                type="button"
                className={`guild-emblem${form.emblem === id ? " on" : ""}`}
                title={t(`guildEmblem_${id}`)}
                onClick={() => setForm({ ...form, emblem: id })}
              >
                <span aria-hidden>{emblemMark(id)}</span>
                {t(`guildEmblem_${id}`)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="stall-act"
            onClick={() =>
              void act(async () => {
                const r = (await api("/guilds", { method: "POST", body: form })) as { id?: string };
                if (r.id) setPick(r.id);
              })
            }
          >
            <span>{t("foundCompany")}</span>
            <em>{String(list?.cost ?? "")}</em>
          </button>
        </div>
      ) : null}
      <div className="stall-actions">
        <button type="button" className="stall-act ghost" onClick={onClose}>
          <span>{t("back")}</span>
        </button>
      </div>
    </div>
  );
}
