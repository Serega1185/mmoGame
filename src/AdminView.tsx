import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useI18n } from "./i18n";

const RARITIES = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"] as const;
const DROP_KINDS = ["normal", "elite", "boss"] as const;

type Rarity = (typeof RARITIES)[number];
type DropKind = (typeof DROP_KINDS)[number];
type RarityWeights = Record<Rarity, number>;
type DropBand = { minDepth: number; tables: Record<DropKind, RarityWeights> };
type DropConfig = { bands: DropBand[] };

type AccountRow = {
  user_id: string;
  username: string;
  email: string;
  role: string;
  coins: number;
  highest_region: number;
  character_id: string | null;
  character_name: string | null;
  character_class: string | null;
  level: number | null;
  region: number | null;
  round: number | null;
  location: string | null;
};

type GuildRow = {
  id: string;
  name: string;
  tag: string;
  level: number;
  emblem: string;
  created_at: number;
  leader_name: string;
  members: number;
};

function pct(w: RarityWeights, r: Rarity) {
  const total = RARITIES.reduce((s, k) => s + (Number(w[k]) || 0), 0);
  if (total <= 0) return "0.0";
  return ((100 * (Number(w[r]) || 0)) / total).toFixed(1);
}

function DropsPanel({ setErr }: { setErr: (s: string) => void }) {
  const { t, te } = useI18n();
  const [cfg, setCfg] = useState<DropConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const data = await api<DropConfig>("/admin/drops");
    setCfg(data);
  }, []);

  useEffect(() => {
    load().catch((e) => setErr(te(e instanceof Error ? e.message : "Denied")));
  }, [load, setErr, te]);

  function patchBand(i: number, next: DropBand) {
    if (!cfg) return;
    const bands = cfg.bands.slice();
    bands[i] = next;
    setCfg({ bands });
    setNote("");
  }

  function setWeight(i: number, kind: DropKind, rarity: Rarity, value: string) {
    if (!cfg) return;
    const n = Number(value);
    const band = cfg.bands[i]!;
    patchBand(i, {
      ...band,
      tables: {
        ...band.tables,
        [kind]: { ...band.tables[kind], [rarity]: Number.isFinite(n) && n >= 0 ? n : 0 },
      },
    });
  }

  async function save() {
    if (!cfg || busy) return;
    setBusy(true);
    try {
      const saved = await api<DropConfig>("/admin/drops", { method: "POST", body: cfg });
      setCfg(saved);
      setNote(t("adminDropsSaved"));
      setErr("");
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "Denied"));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (busy) return;
    setBusy(true);
    try {
      const saved = await api<DropConfig>("/admin/drops/reset", { method: "POST", body: {} });
      setCfg(saved);
      setNote(t("adminDropsSaved"));
      setErr("");
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "Denied"));
    } finally {
      setBusy(false);
    }
  }

  if (!cfg) return <p className="muted">{t("adminDropsHint")}</p>;

  return (
    <div className="admin-drops">
      <p className="muted">{t("adminDropsHint")}</p>
      {cfg.bands.map((band, i) => (
        <div key={`${band.minDepth}-${i}`} className="admin-drop-band">
          <div className="admin-drop-head">
            <label>
              {t("adminDropsFromDepth")}
              <input
                type="number"
                min={0}
                value={band.minDepth}
                onChange={(e) => patchBand(i, { ...band, minDepth: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
              />
            </label>
            {cfg.bands.length > 1 ? (
              <button
                className="danger"
                disabled={busy}
                onClick={() => setCfg({ bands: cfg.bands.filter((_, j) => j !== i) })}
              >
                {t("adminDropsRemoveBand")}
              </button>
            ) : null}
          </div>
          <table className="admin-drop-table">
            <thead>
              <tr>
                <th />
                {RARITIES.map((r) => (
                  <th key={r}>{t(`rarity_${r}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DROP_KINDS.map((kind) => (
                <tr key={kind}>
                  <td>
                    {kind === "normal"
                      ? t("adminDropsKindNormal")
                      : kind === "elite"
                        ? t("adminDropsKindElite")
                        : t("adminDropsKindBoss")}
                  </td>
                  {RARITIES.map((r) => (
                    <td key={r}>
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        value={Number(Number(band.tables[kind][r]).toFixed(3))}
                        aria-label={`${kind} ${r} ${t("adminDropsWeight")}`}
                        onChange={(e) => setWeight(i, kind, r, e.target.value)}
                      />
                      <span className="admin-drop-pct">{t("adminDropsChance", { n: pct(band.tables[kind], r) })}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div className="admin-drop-actions">
        <button
          disabled={busy}
          onClick={() => {
            const last = cfg.bands[cfg.bands.length - 1]!;
            setCfg({
              bands: [
                ...cfg.bands,
                {
                  minDepth: last.minDepth + 5,
                  tables: {
                    normal: { ...last.tables.normal },
                    elite: { ...last.tables.elite },
                    boss: { ...last.tables.boss },
                  },
                },
              ],
            });
          }}
        >
          {t("adminDropsAddBand")}
        </button>
        <button className="gold" disabled={busy} onClick={() => void save()}>
          {t("adminDropsSave")}
        </button>
        <button disabled={busy} onClick={() => void reset()}>
          {t("adminDropsReset")}
        </button>
        {note ? <span className="muted">{note}</span> : null}
      </div>
    </div>
  );
}

function GatePanel({ setErr }: { setErr: (s: string) => void }) {
  const { t, te } = useI18n();
  const [version, setVersion] = useState("");
  const [maintenance, setMaintenance] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const data = await api<{ version: string; maintenance: boolean; message: string }>("/admin/gate");
    setVersion(data.version);
    setMaintenance(!!data.maintenance);
    setMessage(data.message || "");
  }, []);

  useEffect(() => {
    load().catch((e) => setErr(te(e instanceof Error ? e.message : "Denied")));
  }, [load, setErr, te]);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const saved = await api<{ version: string; maintenance: boolean; message: string }>("/admin/gate", {
        method: "POST",
        body: { version, maintenance, message },
      });
      setVersion(saved.version);
      setMaintenance(!!saved.maintenance);
      setMessage(saved.message || "");
      setNote(t("adminGateSaved"));
      setErr("");
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "Denied"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-drops" style={{ maxWidth: 560 }}>
      <p className="muted">{t("adminGateHint")}</p>
      <label>{t("adminGateVersion")}</label>
      <input value={version} onChange={(e) => { setVersion(e.target.value); setNote(""); }} maxLength={40} />
      <label className="admin-gate-check">
        <input type="checkbox" checked={maintenance} onChange={(e) => { setMaintenance(e.target.checked); setNote(""); }} />
        {t("adminGateMaintenance")}
      </label>
      <label>{t("adminGateMessage")}</label>
      <textarea
        rows={6}
        value={message}
        maxLength={2000}
        onChange={(e) => { setMessage(e.target.value); setNote(""); }}
      />
      <div className="admin-drop-actions">
        <button className="gold" disabled={busy} onClick={() => void save()}>
          {t("adminGateSave")}
        </button>
        {note ? <span className="muted">{note}</span> : null}
      </div>
    </div>
  );
}

export function AdminView({
  onClose,
  reload,
  setErr,
}: {
  onClose: () => void;
  reload: () => Promise<void>;
  setErr: (s: string) => void;
}) {
  const { t, te } = useI18n();
  const [tab, setTab] = useState<"wayfarers" | "guilds" | "drops" | "gate">("wayfarers");
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [guilds, setGuilds] = useState<GuildRow[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await api<{ accounts: AccountRow[]; guilds: GuildRow[] }>("/admin/ledger");
    setAccounts(data.accounts);
    setGuilds(data.guilds);
  }, []);

  useEffect(() => {
    load().catch((e) => setErr(te(e instanceof Error ? e.message : "Denied")));
  }, [load, setErr, te]);

  async function run(key: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
      await load();
      await reload();
      setErr("");
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "Denied"));
    } finally {
      setBusy(null);
    }
  }

  function amountOf(userId: string) {
    const n = Math.trunc(Number(amounts[userId] ?? "100"));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  return (
    <div className="panel admin-hall">
      <div className="section-title">{t("seneschalTitle")}</div>
      <p className="muted">{t("adminHint")}</p>
      <div className="left-tabs admin-tabs">
        <button className={tab === "wayfarers" ? "gold" : ""} onClick={() => setTab("wayfarers")}>
          {t("adminTabWayfarers")}
        </button>
        <button className={tab === "guilds" ? "gold" : ""} onClick={() => setTab("guilds")}>
          {t("adminTabGuilds")}
        </button>
        <button className={tab === "drops" ? "gold" : ""} onClick={() => setTab("drops")}>
          {t("adminTabDrops")}
        </button>
        <button className={tab === "gate" ? "gold" : ""} onClick={() => setTab("gate")}>
          {t("adminTabGate")}
        </button>
      </div>

      {tab === "gate" ? (
        <GatePanel setErr={setErr} />
      ) : tab === "drops" ? (
        <DropsPanel setErr={setErr} />
      ) : tab === "wayfarers" ? (
        <div className="admin-table-wrap">
          <table className="board-table admin-table">
            <thead>
              <tr>
                <th>{t("adminAccount")}</th>
                <th>{t("adminCharacter")}</th>
                <th>{t("adminClass")}</th>
                <th>{t("adminLevel")}</th>
                <th>{t("adminRegion")}</th>
                <th>{t("crowns")}</th>
                <th>{t("adminActions")}</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((row) => (
                <tr key={row.user_id}>
                  <td>
                    <div className="admin-nick">{row.username}</div>
                    <div className="muted">{row.email}</div>
                    {row.role === "admin" ? <div className="muted">{t("seneschal")}</div> : null}
                  </td>
                  <td>{row.character_name || t("adminNoCharacter")}</td>
                  <td>
                    {row.character_class ? t(`class_${row.character_class}`) || row.character_class : "—"}
                  </td>
                  <td>{row.level ?? "—"}</td>
                  <td>{row.region != null ? `${row.region} · ${row.round}` : "—"}</td>
                  <td className="admin-coins">{row.coins}</td>
                  <td>
                    <div className="admin-actions">
                      <input
                        type="number"
                        min={1}
                        value={amounts[row.user_id] ?? "100"}
                        onChange={(e) => setAmounts({ ...amounts, [row.user_id]: e.target.value })}
                        aria-label={t("crowns")}
                      />
                      <button
                        disabled={busy !== null || amountOf(row.user_id) <= 0}
                        onClick={() =>
                          run(`add-${row.user_id}`, () =>
                            api("/admin/coins", { method: "POST", body: { userId: row.user_id, amount: amountOf(row.user_id) } }).then(() => undefined)
                          )
                        }
                      >
                        {t("adminGive")}
                      </button>
                      <button
                        disabled={busy !== null || amountOf(row.user_id) <= 0}
                        onClick={() =>
                          run(`take-${row.user_id}`, () =>
                            api("/admin/coins", { method: "POST", body: { userId: row.user_id, amount: -amountOf(row.user_id) } }).then(() => undefined)
                          )
                        }
                      >
                        {t("adminTake")}
                      </button>
                      <button
                        className="danger"
                        disabled={busy !== null || !row.character_id}
                        onClick={() => {
                          if (!row.character_id) return;
                          if (!confirm(t("adminDeleteCharConfirm", { name: row.character_name || "" }))) return;
                          void run(`del-${row.character_id}`, () =>
                            api("/admin/character/delete", { method: "POST", body: { characterId: row.character_id } }).then(
                              () => undefined
                            )
                          );
                        }}
                      >
                        {t("adminDeleteChar")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="board-table admin-table">
            <thead>
              <tr>
                <th>{t("adminGuild")}</th>
                <th>{t("adminTag")}</th>
                <th>{t("adminGuildLevel")}</th>
                <th>{t("adminMembers")}</th>
                <th>{t("adminLeader")}</th>
                <th>{t("adminActions")}</th>
              </tr>
            </thead>
            <tbody>
              {guilds.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    {t("adminNoGuilds")}
                  </td>
                </tr>
              ) : (
                guilds.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <div className="admin-nick">{g.name}</div>
                      <div className="muted">{g.emblem}</div>
                    </td>
                    <td>[{g.tag}]</td>
                    <td>{g.level}</td>
                    <td>{g.members}</td>
                    <td>{g.leader_name}</td>
                    <td>
                      <button
                        className="danger"
                        disabled={busy !== null}
                        onClick={() => {
                          if (!confirm(t("adminDeleteGuildConfirm", { name: g.name }))) return;
                          void run(`g-${g.id}`, () =>
                            api("/admin/guild/delete", { method: "POST", body: { guildId: g.id } }).then(() => undefined)
                          );
                        }}
                      >
                        {t("adminDeleteGuild")}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <button style={{ marginTop: 12 }} onClick={onClose}>
        {t("return")}
      </button>
    </div>
  );
}
