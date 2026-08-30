import { useCallback, useEffect, useState } from "react";
import { api, STAT_KEYS } from "./api";
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

function withLuckPreview(weights: RarityWeights, luck: number): RarityWeights {
  const boost = 1 + Math.max(0, Number(luck) || 0) / 100;
  const out = {} as RarityWeights;
  for (const r of RARITIES) {
    const n = Number(weights[r]) || 0;
    const idx = RARITIES.indexOf(r);
    out[r] = idx >= 2 ? n * boost : n;
  }
  return out;
}

function DropsPanel({ setErr }: { setErr: (s: string) => void }) {
  const { t, te } = useI18n();
  const [cfg, setCfg] = useState<DropConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [luck, setLuck] = useState(0);

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
      <label className="admin-luck-preview">
        {t("adminDropsLuck")}
        <input
          type="number"
          min={0}
          step="1"
          value={luck}
          onChange={(e) => setLuck(Math.max(0, Number(e.target.value) || 0))}
        />
        <span className="muted">{t("adminDropsLuckHint")}</span>
      </label>
      {cfg.bands.map((band, i) => (
        <div key={`${band.minDepth}-${i}`} className="admin-drop-band">
          <div className="admin-drop-head">
            <label>
              {t("adminDropsFromDepth")}
              <input
                type="number"
                min={1}
                value={band.minDepth}
                onChange={(e) => patchBand(i, { ...band, minDepth: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })}
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
                  {RARITIES.map((r) => {
                    const shown = withLuckPreview(band.tables[kind], luck);
                    return (
                    <td key={r}>
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        value={Number(Number(band.tables[kind][r]).toFixed(3))}
                        aria-label={`${kind} ${r} ${t("adminDropsWeight")}`}
                        onChange={(e) => setWeight(i, kind, r, e.target.value)}
                      />
                      <span className="admin-drop-pct">{t("adminDropsChance", { n: pct(shown, r) })}</span>
                    </td>
                    );
                  })}
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

type ShopBand = { minDepth: number; weights: RarityWeights };
type ShopConfig = { bands: ShopBand[]; restockMinutes: number };

function ShopRarityPanel({ setErr }: { setErr: (s: string) => void }) {
  const { t, te } = useI18n();
  const [cfg, setCfg] = useState<ShopConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const data = await api<ShopConfig>("/admin/shop");
    setCfg(data);
  }, []);

  useEffect(() => {
    load().catch((e) => setErr(te(e instanceof Error ? e.message : "Denied")));
  }, [load, setErr, te]);

  function patchBand(i: number, next: ShopBand) {
    if (!cfg) return;
    const bands = cfg.bands.slice();
    bands[i] = next;
    setCfg({ bands });
    setNote("");
  }

  function setWeight(i: number, rarity: Rarity, value: string) {
    if (!cfg) return;
    const n = Number(value);
    const band = cfg.bands[i]!;
    patchBand(i, {
      ...band,
      weights: { ...band.weights, [rarity]: Number.isFinite(n) && n >= 0 ? n : 0 },
    });
  }

  async function save() {
    if (!cfg || busy) return;
    setBusy(true);
    try {
      const saved = await api<ShopConfig>("/admin/shop", { method: "POST", body: cfg });
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
      const saved = await api<ShopConfig>("/admin/shop/reset", { method: "POST", body: {} });
      setCfg(saved);
      setNote(t("adminDropsSaved"));
      setErr("");
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "Denied"));
    } finally {
      setBusy(false);
    }
  }

  if (!cfg) return <p className="muted">{t("adminShopHint")}</p>;

  return (
    <div className="admin-drops">
      <p className="muted">{t("adminShopHint")}</p>
      <label className="admin-luck-preview">
        {t("adminShopRestock")}
        <input
          type="number"
          min={1}
          max={1440}
          step="1"
          value={cfg.restockMinutes}
          onChange={(e) => {
            setCfg({ ...cfg, restockMinutes: Math.max(1, Math.trunc(Number(e.target.value) || 1)) });
            setNote("");
          }}
        />
      </label>
      {cfg.bands.map((band, i) => (
        <div key={`${band.minDepth}-${i}`} className="admin-drop-band">
          <div className="admin-drop-head">
            <label>
              {t("adminDropsFromDepth")}
              <input
                type="number"
                min={1}
                value={band.minDepth}
                onChange={(e) => patchBand(i, { ...band, minDepth: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })}
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
                {RARITIES.map((r) => (
                  <th key={r}>{t(`rarity_${r}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {RARITIES.map((r) => (
                  <td key={r}>
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      value={band.weights[r]}
                      onChange={(e) => setWeight(i, r, e.target.value)}
                      aria-label={`${r} ${t("adminDropsWeight")}`}
                    />
                    <span className="admin-drop-pct">{t("adminDropsChance", { n: pct(band.weights, r) })}</span>
                  </td>
                ))}
              </tr>
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
                  minDepth: last.minDepth + 1,
                  weights: { ...last.weights },
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

type PackBand = { minDepth: number; two: number; three: number };
type PackConfig = { bands: PackBand[] };

function PacksPanel({ setErr }: { setErr: (s: string) => void }) {
  const { t, te } = useI18n();
  const [cfg, setCfg] = useState<PackConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const data = await api<PackConfig>("/admin/packs");
    setCfg(data);
  }, []);

  useEffect(() => {
    load().catch((e) => setErr(te(e instanceof Error ? e.message : "Denied")));
  }, [load, setErr, te]);

  function patchBand(i: number, next: PackBand) {
    if (!cfg) return;
    const bands = cfg.bands.slice();
    bands[i] = next;
    setCfg({ bands });
    setNote("");
  }

  async function save() {
    if (!cfg || busy) return;
    setBusy(true);
    try {
      const saved = await api<PackConfig>("/admin/packs", { method: "POST", body: cfg });
      setCfg(saved);
      setNote(t("adminPacksSaved"));
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
      const saved = await api<PackConfig>("/admin/packs/reset", { method: "POST", body: {} });
      setCfg(saved);
      setNote(t("adminPacksSaved"));
      setErr("");
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "Denied"));
    } finally {
      setBusy(false);
    }
  }

  if (!cfg) return <p className="muted">{t("adminPacksHint")}</p>;

  return (
    <div className="admin-drops">
      <p className="muted">{t("adminPacksHint")}</p>
      {cfg.bands.map((band, i) => (
        <div key={`${band.minDepth}-${i}`} className="admin-drop-band">
          <div className="admin-drop-head">
            <label>
              {t("adminDropsFromDepth")}
              <input
                type="number"
                min={1}
                value={band.minDepth}
                onChange={(e) => patchBand(i, { ...band, minDepth: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })}
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
          <label>
            {t("adminPacksTwo")}
            <input
              type="number"
              min={0}
              max={100}
              step="0.1"
              value={band.two}
              onChange={(e) => patchBand(i, { ...band, two: Math.max(0, Number(e.target.value) || 0) })}
            />
            <span className="muted">%</span>
          </label>
          <label>
            {t("adminPacksThree")}
            <input
              type="number"
              min={0}
              max={100}
              step="0.1"
              value={band.three}
              onChange={(e) => patchBand(i, { ...band, three: Math.max(0, Number(e.target.value) || 0) })}
            />
            <span className="muted">%</span>
          </label>
        </div>
      ))}
      <div className="admin-drop-actions">
        <button
          disabled={busy}
          onClick={() => {
            const last = cfg.bands[cfg.bands.length - 1]!;
            setCfg({
              bands: [...cfg.bands, { minDepth: last.minDepth + 5, two: last.two, three: last.three }],
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

const MINE_ORES = ["copper", "iron", "gold", "mithril", "adamantite", "titanium"] as const;
type MineOre = (typeof MINE_ORES)[number];
type MineWeights = Record<MineOre, number>;
type MineBand = { minDepth: number; minMines: number; maxMines: number; weights: MineWeights };
type MineConfig = { bands: MineBand[] };

function MinesPanel({ setErr }: { setErr: (s: string) => void }) {
  const { t, te } = useI18n();
  const [cfg, setCfg] = useState<MineConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setCfg(await api<MineConfig>("/admin/mines"));
  }, []);

  useEffect(() => {
    load().catch((e) => setErr(te(e instanceof Error ? e.message : "Denied")));
  }, [load, setErr, te]);

  function patchBand(i: number, next: MineBand) {
    if (!cfg) return;
    const bands = cfg.bands.slice();
    bands[i] = next;
    setCfg({ bands });
    setNote("");
  }

  async function save() {
    if (!cfg || busy) return;
    setBusy(true);
    try {
      setCfg(await api<MineConfig>("/admin/mines", { method: "POST", body: cfg }));
      setNote(t("adminMinesSaved"));
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
      setCfg(await api<MineConfig>("/admin/mines/reset", { method: "POST", body: {} }));
      setNote(t("adminMinesSaved"));
      setErr("");
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "Denied"));
    } finally {
      setBusy(false);
    }
  }

  if (!cfg) return <p className="muted">{t("adminMinesHint")}</p>;

  return (
    <div className="admin-drops">
      <p className="muted">{t("adminMinesHint")}</p>
      {cfg.bands.map((band, i) => {
        const total = MINE_ORES.reduce((s, k) => s + (Number(band.weights[k]) || 0), 0);
        return (
          <div key={`${band.minDepth}-${i}`} className="admin-drop-band">
            <div className="admin-drop-head">
              <label>
                {t("adminDropsFromDepth")}
                <input
                  type="number"
                  min={1}
                  value={band.minDepth}
                  onChange={(e) => patchBand(i, { ...band, minDepth: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })}
                />
              </label>
              <label>
                {t("adminMinesMin")}
                <input
                  type="number"
                  min={0}
                  value={band.minMines}
                  onChange={(e) => patchBand(i, { ...band, minMines: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
                />
              </label>
              <label>
                {t("adminMinesMax")}
                <input
                  type="number"
                  min={0}
                  value={band.maxMines}
                  onChange={(e) => patchBand(i, { ...band, maxMines: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
                />
              </label>
              {cfg.bands.length > 1 ? (
                <button className="danger" disabled={busy} onClick={() => setCfg({ bands: cfg.bands.filter((_, j) => j !== i) })}>
                  {t("adminDropsRemoveBand")}
                </button>
              ) : null}
            </div>
            <table className="admin-drop-table">
              <thead>
                <tr>
                  {MINE_ORES.map((id) => (
                    <th key={id}>{t(`node_mine_${id}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {MINE_ORES.map((id) => (
                    <td key={id}>
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        value={band.weights[id]}
                        onChange={(e) =>
                          patchBand(i, {
                            ...band,
                            weights: { ...band.weights, [id]: Math.max(0, Number(e.target.value) || 0) },
                          })
                        }
                      />
                      <span className="admin-drop-pct">
                        {t("adminDropsChance", { n: total > 0 ? ((100 * band.weights[id]) / total).toFixed(1) : "0.0" })}
                      </span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
      <div className="admin-drop-actions">
        <button
          disabled={busy}
          onClick={() => {
            const last = cfg.bands[cfg.bands.length - 1]!;
            setCfg({ bands: [...cfg.bands, { ...last, minDepth: last.minDepth + 1, weights: { ...last.weights } }] });
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

type ItemLocale = { name: string; flavor: string };
type AdminItem = {
  id: string;
  slot: string | null;
  rarity_min: string;
  required_level: number;
  set_id: string | null;
  icon: string;
  twohand: boolean;
  school: string;
  base_stats: Record<string, number>;
  i18n: Record<"en" | "ru" | "zh", ItemLocale>;
};

const EMPTY_LOCALE: ItemLocale = { name: "", flavor: "" };
const EMPTY_ITEM: AdminItem = {
  id: "",
  slot: "Weapon",
  rarity_min: "Common",
  required_level: 1,
  set_id: null,
  icon: "",
  twohand: false,
  school: "",
  base_stats: {},
  i18n: { en: { ...EMPTY_LOCALE }, ru: { ...EMPTY_LOCALE }, zh: { ...EMPTY_LOCALE } },
};

function ItemsPanel({ setErr }: { setErr: (s: string) => void }) {
  const { t, te, itemName, reloadCatalog } = useI18n();
  const [items, setItems] = useState<AdminItem[]>([]);
  const [sets, setSets] = useState<{ id: string; name: string }[]>([]);
  const [icons, setIcons] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"level" | "name">("level");
  const [edit, setEdit] = useState<AdminItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [idLocked, setIdLocked] = useState(false);

  const load = useCallback(async () => {
    const data = await api<{ items: AdminItem[]; sets: { id: string; name: string }[]; icons: string[] }>("/admin/items");
    setItems(data.items);
    setSets(data.sets || []);
    setIcons(data.icons || []);
  }, []);

  useEffect(() => {
    load().catch((e) => setErr(te(e instanceof Error ? e.message : "Denied")));
  }, [load, setErr, te]);

  const shown = items
    .filter((it) => {
      const blob = [it.id, it.i18n.en.name, it.i18n.ru.name, it.i18n.zh.name, itemName(it.id)].join(" ").toLowerCase();
      return !q.trim() || blob.includes(q.trim().toLowerCase());
    })
    .slice()
    .sort((a, b) =>
      sort === "name"
        ? (a.i18n.ru.name || a.i18n.en.name).localeCompare(b.i18n.ru.name || b.i18n.en.name)
        : a.required_level - b.required_level || (a.i18n.en.name || a.id).localeCompare(b.i18n.en.name || b.id)
    );

  function patchI18n(lang: "en" | "ru" | "zh", bit: Partial<ItemLocale>) {
    if (!edit) return;
    setEdit({ ...edit, i18n: { ...edit.i18n, [lang]: { ...edit.i18n[lang], ...bit } } });
  }

  async function save() {
    if (!edit || busy) return;
    setBusy(true);
    try {
      await api("/admin/items", {
        method: "POST",
        body: {
          id: edit.id,
          slot: edit.slot,
          rarity_min: edit.rarity_min,
          required_level: edit.required_level,
          set_id: edit.set_id,
          icon: edit.icon,
          school: edit.school,
          twohand: edit.twohand,
          base_stats: edit.base_stats,
          names: { en: edit.i18n.en.name, ru: edit.i18n.ru.name, zh: edit.i18n.zh.name },
          flavors: { en: edit.i18n.en.flavor, ru: edit.i18n.ru.flavor, zh: edit.i18n.zh.flavor },
        },
      });
      setNote(t("adminItemsSaved"));
      setIdLocked(true);
      await load();
      await reloadCatalog();
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "Denied"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (busy) return;
    if (!confirm(t("adminItemsDeleteConfirm", { name: id }))) return;
    setBusy(true);
    try {
      await api("/admin/items/delete", { method: "POST", body: { id } });
      if (edit?.id === id) setEdit(null);
      await load();
      await reloadCatalog();
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "Denied"));
    } finally {
      setBusy(false);
    }
  }

  async function uploadIcon(file: File) {
    if (!edit) return;
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(new Error("That is not an image."));
      r.readAsDataURL(file);
    });
    const saved = await api<{ path: string }>("/admin/items/icon", { method: "POST", body: { data } });
    setEdit({ ...edit, icon: saved.path });
    setIcons((prev) => (prev.includes(saved.path) ? prev : [saved.path, ...prev]));
  }

  return (
    <div className="admin-drops" style={{ maxWidth: 1100 }}>
      <p className="muted">{t("adminItemsHint")}</p>
      <div className="admin-drop-head">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("adminItemsSearch")} />
        <button className={sort === "level" ? "gold" : ""} onClick={() => setSort("level")}>
          {t("adminItemsSortLevel")}
        </button>
        <button className={sort === "name" ? "gold" : ""} onClick={() => setSort("name")}>
          {t("adminItemsSortName")}
        </button>
        <button
          className="gold"
          onClick={() => {
            setIdLocked(false);
            setEdit({
              ...EMPTY_ITEM,
              id: `custom_${Date.now().toString(36)}`,
              i18n: { en: { ...EMPTY_LOCALE }, ru: { ...EMPTY_LOCALE }, zh: { ...EMPTY_LOCALE } },
              base_stats: {},
            });
          }}
        >
          {t("adminItemsNew")}
        </button>
      </div>
      {edit ? (
        <div className="admin-drop-band admin-item-form">
          <label>
            id
            <input value={edit.id} disabled={idLocked} onChange={(e) => setEdit({ ...edit, id: e.target.value })} />
          </label>
          <label>
            {t("slot")}
            <select value={edit.slot || ""} onChange={(e) => setEdit({ ...edit, slot: e.target.value || null })}>
              <option value="">—</option>
              {["Head", "Chest", "Gloves", "Legs", "Boots", "Weapon", "Offhand", "Neck", "Ring1", "Ring2"].map((s) => (
                <option key={s} value={s}>
                  {t(`slot_${s}`) || s}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("rarity")}
            <select value={edit.rarity_min} onChange={(e) => setEdit({ ...edit, rarity_min: e.target.value })}>
              {RARITIES.map((r) => (
                <option key={r} value={r}>
                  {t(`rarity_${r}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("adminItemsReqLevel")}
            <input
              type="number"
              min={1}
              value={edit.required_level}
              onChange={(e) => setEdit({ ...edit, required_level: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })}
            />
          </label>
          <label>
            {t("set")}
            <select value={edit.set_id || ""} onChange={(e) => setEdit({ ...edit, set_id: e.target.value || null })}>
              <option value="">{t("adminItemsNoSet")}</option>
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("adminItemsSchool")}
            <select value={edit.school} onChange={(e) => setEdit({ ...edit, school: e.target.value })}>
              <option value="">{t("adminItemsNoSchool")}</option>
              <option value="chain">{t("school_chain")}</option>
              <option value="fire">{t("school_fire")}</option>
              <option value="frost">{t("school_frost")}</option>
            </select>
          </label>
          {edit.slot === "Weapon" ? (
            <label className="admin-check">
              <input type="checkbox" checked={edit.twohand} onChange={(e) => setEdit({ ...edit, twohand: e.target.checked })} />
              {t("adminItemsTwohand")}
            </label>
          ) : null}

          <div className="admin-i18n">
            {(["en", "ru", "zh"] as const).map((lang) => (
              <div key={lang} className="admin-i18n-col">
                <div className="muted">{lang.toUpperCase()}</div>
                <label>
                  {t("adminItemsName")}
                  <input value={edit.i18n[lang].name} onChange={(e) => patchI18n(lang, { name: e.target.value })} />
                </label>
                <label>
                  {t("adminItemsFlavor")}
                  <input value={edit.i18n[lang].flavor} onChange={(e) => patchI18n(lang, { flavor: e.target.value })} />
                </label>
              </div>
            ))}
          </div>

          <div className="admin-icon-row">
            <div className="admin-icon-preview">
              {edit.icon ? <img src={edit.icon} alt="" /> : <span className="muted">{t("adminItemsNoArt")}</span>}
            </div>
            <label>
              {t("adminItemsIcon")}
              <input value={edit.icon} onChange={(e) => setEdit({ ...edit, icon: e.target.value })} placeholder="/assets/64x64/bow_01.png" />
            </label>
            <label className="admin-upload">
              {t("adminItemsUpload")}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadIcon(f).catch((err) => setErr(te(err instanceof Error ? err.message : "Denied")));
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {icons.length ? (
            <div className="admin-icon-grid">
              {icons.map((src) => (
                <button
                  key={src}
                  type="button"
                  className={edit.icon === src ? "gold" : ""}
                  title={src}
                  onClick={() => setEdit({ ...edit, icon: src })}
                >
                  <img src={src} alt="" />
                </button>
              ))}
            </div>
          ) : null}

          <div className="admin-stats-grid">
            <div className="muted">{t("adminItemsStats")}</div>
            {STAT_KEYS.map((k) => (
              <label key={k}>
                {t(`stat_${k}`)}
                <input
                  type="number"
                  step="0.1"
                  value={edit.base_stats[k] || ""}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    const next = { ...edit.base_stats };
                    if (!e.target.value || !Number.isFinite(n)) delete next[k];
                    else next[k] = n;
                    setEdit({ ...edit, base_stats: next });
                  }}
                />
              </label>
            ))}
          </div>

          <div className="admin-drop-actions">
            <button className="gold" disabled={busy} onClick={() => void save()}>
              {t("adminDropsSave")}
            </button>
            <button disabled={busy} onClick={() => setEdit(null)}>
              {t("closeMap")}
            </button>
            {note ? <span className="muted">{note}</span> : null}
          </div>
        </div>
      ) : null}
      <div className="admin-table-wrap">
        <table className="board-table admin-table">
          <thead>
            <tr>
              <th>{t("name")}</th>
              <th>{t("adminItemsReqLevel")}</th>
              <th>{t("rarity")}</th>
              <th>{t("slot")}</th>
              <th>{t("adminActions")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((it) => (
              <tr key={it.id}>
                <td>
                  {itemName(it.id) || it.i18n.ru.name || it.i18n.en.name}
                  <div className="muted">{it.id}</div>
                </td>
                <td>{it.required_level}</td>
                <td>{t(`rarity_${it.rarity_min}`)}</td>
                <td>{it.slot ? t(`slot_${it.slot}`) || it.slot : "—"}</td>
                <td>
                  <div className="admin-actions">
                    <button
                      disabled={busy}
                      onClick={() => {
                        setIdLocked(true);
                        setEdit({
                          ...it,
                          i18n: {
                            en: it.i18n?.en || { ...EMPTY_LOCALE },
                            ru: it.i18n?.ru || { ...EMPTY_LOCALE },
                            zh: it.i18n?.zh || { ...EMPTY_LOCALE },
                          },
                          base_stats: it.base_stats || {},
                        });
                      }}
                    >
                      {t("adminItemsEdit")}
                    </button>
                    <button className="danger" disabled={busy} onClick={() => void remove(it.id)}>
                      {t("adminItemsDelete")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
  const [tab, setTab] = useState<"wayfarers" | "guilds" | "drops" | "shop" | "packs" | "mines" | "items" | "gate">(
    "wayfarers"
  );
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
        <button className={tab === "shop" ? "gold" : ""} onClick={() => setTab("shop")}>
          {t("adminTabShop")}
        </button>
        <button className={tab === "packs" ? "gold" : ""} onClick={() => setTab("packs")}>
          {t("adminTabPacks")}
        </button>
        <button className={tab === "mines" ? "gold" : ""} onClick={() => setTab("mines")}>
          {t("adminTabMines")}
        </button>
        <button className={tab === "items" ? "gold" : ""} onClick={() => setTab("items")}>
          {t("adminTabItems")}
        </button>
        <button className={tab === "gate" ? "gold" : ""} onClick={() => setTab("gate")}>
          {t("adminTabGate")}
        </button>
      </div>

      {tab === "gate" ? (
        <GatePanel setErr={setErr} />
      ) : tab === "drops" ? (
        <DropsPanel setErr={setErr} />
      ) : tab === "shop" ? (
        <ShopRarityPanel setErr={setErr} />
      ) : tab === "packs" ? (
        <PacksPanel setErr={setErr} />
      ) : tab === "mines" ? (
        <MinesPanel setErr={setErr} />
      ) : tab === "items" ? (
        <ItemsPanel setErr={setErr} />
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
