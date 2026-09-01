import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { api, STAT_KEYS } from "./api";
import { useI18n } from "./i18n";
import type { Item } from "./api";
import { HeroFace, HoverHint, ItemFace, ItemTooltip } from "./ui";
import { TalentBoard, type TalentLane, type TalentNodeView, type TalentTreeData } from "./TalentTree";

const RARITIES = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"] as const;
const DROP_KINDS = ["normal", "elite", "boss"] as const;

function scrollEditIntoView(form: HTMLElement | null) {
  if (!form) return;
  const hall = form.closest(".admin-hall");
  if (!(hall instanceof HTMLElement)) return;
  const row = hall.querySelector(".admin-row-editing");
  const target = row instanceof HTMLElement ? row : form;
  const hallRect = hall.getBoundingClientRect();
  const t = target.getBoundingClientRect();
  const formRect = form.getBoundingClientRect();
  const rowVisible = t.top >= hallRect.top - 2 && t.bottom <= hallRect.bottom;
  const formStartVisible = formRect.top < hallRect.bottom - 72;
  if (rowVisible && formStartVisible) return;
  hall.scrollTop += t.top - hallRect.top;
}

type Rarity = (typeof RARITIES)[number];
type DropKind = (typeof DROP_KINDS)[number];
type RarityWeights = Record<Rarity, number>;
type LevelRange = { min: number; max: number };
type DropBand = {
  minDepth: number;
  beforeCity: LevelRange;
  afterCity: LevelRange;
};
type DropConfig = {
  tables: Record<DropKind, RarityWeights>;
  bands: DropBand[];
};

function defaultLevelRanges(minDepth: number): { beforeCity: LevelRange; afterCity: LevelRange } {
  const d = Math.max(1, Math.trunc(Number(minDepth) || 1));
  return { beforeCity: { min: d, max: d + 2 }, afterCity: { min: d + 1, max: d + 4 } };
}

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

  function patch(next: Partial<DropConfig>) {
    if (!cfg) return;
    setCfg({ ...cfg, ...next });
    setNote("");
  }

  function patchBand(i: number, next: DropBand) {
    if (!cfg) return;
    const bands = cfg.bands.slice();
    bands[i] = next;
    setCfg({ ...cfg, bands });
    setNote("");
  }

  function setWeight(kind: DropKind, rarity: Rarity, value: string) {
    if (!cfg) return;
    const n = Number(value);
    patch({
      tables: {
        ...cfg.tables,
        [kind]: { ...cfg.tables[kind], [rarity]: Number.isFinite(n) && n >= 0 ? n : 0 },
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

  if (!cfg?.tables || !cfg.bands) return <p className="muted">{t("adminDropsHint")}</p>;

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
      <div className="admin-drop-band">
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
                    const shown = withLuckPreview(cfg.tables[kind], luck);
                    return (
                    <td key={r}>
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        value={Number(Number(cfg.tables[kind][r]).toFixed(3))}
                        aria-label={`${kind} ${r} ${t("adminDropsWeight")}`}
                        onChange={(e) => setWeight(kind, r, e.target.value)}
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
                onClick={() => setCfg({ ...cfg, bands: cfg.bands.filter((_, j) => j !== i) })}
              >
                {t("adminDropsRemoveBand")}
              </button>
            ) : null}
          </div>
          <div className="admin-drop-levels">
            <label>
              {t("adminDropsBeforeCity")}
              <input
                type="number"
                min={1}
                value={band.beforeCity?.min ?? 1}
                onChange={(e) =>
                  patchBand(i, {
                    ...band,
                    beforeCity: {
                      min: Math.max(1, Math.trunc(Number(e.target.value) || 1)),
                      max: band.beforeCity?.max ?? 1,
                    },
                  })
                }
              />
              <span className="muted">{t("adminDropsLevelTo")}</span>
              <input
                type="number"
                min={1}
                value={band.beforeCity?.max ?? 1}
                onChange={(e) =>
                  patchBand(i, {
                    ...band,
                    beforeCity: {
                      min: band.beforeCity?.min ?? 1,
                      max: Math.max(1, Math.trunc(Number(e.target.value) || 1)),
                    },
                  })
                }
              />
            </label>
            <label>
              {t("adminDropsAfterCity")}
              <input
                type="number"
                min={1}
                value={band.afterCity?.min ?? 1}
                onChange={(e) =>
                  patchBand(i, {
                    ...band,
                    afterCity: {
                      min: Math.max(1, Math.trunc(Number(e.target.value) || 1)),
                      max: band.afterCity?.max ?? 1,
                    },
                  })
                }
              />
              <span className="muted">{t("adminDropsLevelTo")}</span>
              <input
                type="number"
                min={1}
                value={band.afterCity?.max ?? 1}
                onChange={(e) =>
                  patchBand(i, {
                    ...band,
                    afterCity: {
                      min: band.afterCity?.min ?? 1,
                      max: Math.max(1, Math.trunc(Number(e.target.value) || 1)),
                    },
                  })
                }
              />
            </label>
          </div>
        </div>
      ))}
      <div className="admin-drop-actions">
        <button
          disabled={busy}
          onClick={() => {
            const last = cfg.bands[cfg.bands.length - 1]!;
            const minDepth = last.minDepth + 5;
            const levels = defaultLevelRanges(minDepth);
            setCfg({
              ...cfg,
              bands: [...cfg.bands, { minDepth, beforeCity: levels.beforeCity, afterCity: levels.afterCity }],
            });
            setNote("");
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

type ShopBand = { minDepth: number; weights: RarityWeights; itemMin: number; itemMax: number };
type ShopConfig = { bands: ShopBand[]; restockMinutes: number };

function defaultShopLevels(minDepth: number) {
  const d = Math.max(1, Math.trunc(Number(minDepth) || 1));
  return { itemMin: d, itemMax: d + 5 };
}

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
    setCfg({ ...cfg, bands });
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
                onClick={() => setCfg({ ...cfg, bands: cfg.bands.filter((_, j) => j !== i) })}
              >
                {t("adminDropsRemoveBand")}
              </button>
            ) : null}
          </div>
          <div className="admin-drop-levels">
            <label>
              {t("adminShopItemLevels")}
              <input
                type="number"
                min={1}
                value={band.itemMin ?? 1}
                onChange={(e) =>
                  patchBand(i, { ...band, itemMin: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })
                }
              />
              <span className="muted">{t("adminDropsLevelTo")}</span>
              <input
                type="number"
                min={1}
                value={band.itemMax ?? 1}
                onChange={(e) =>
                  patchBand(i, { ...band, itemMax: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })
                }
              />
            </label>
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
            const minDepth = last.minDepth + 1;
            const levels = defaultShopLevels(minDepth);
            setCfg({
              ...cfg,
              bands: [
                ...cfg.bands,
                {
                  minDepth,
                  weights: { ...last.weights },
                  itemMin: levels.itemMin,
                  itemMax: levels.itemMax,
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
type MapGlobals = {
  refreshMinutes: number;
  eliteMin: number;
  eliteMax: number;
  mysteryMin: number;
  mysteryMax: number;
  campMin: number;
  campMax: number;
  campCoins: number;
  campDepthMul: number;
};

function MapGlobalsPanel({ setErr }: { setErr: (s: string) => void }) {
  const { t, te } = useI18n();
  const [cfg, setCfg] = useState<MapGlobals | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setCfg(await api<MapGlobals>("/admin/map-globals"));
  }, []);

  useEffect(() => {
    load().catch((e) => setErr(te(e instanceof Error ? e.message : "Denied")));
  }, [load, setErr, te]);

  async function save() {
    if (!cfg || busy) return;
    setBusy(true);
    try {
      setCfg(await api<MapGlobals>("/admin/map-globals", { method: "POST", body: cfg }));
      setNote(t("adminMapGlobalsSaved"));
      setErr("");
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "Denied"));
    } finally {
      setBusy(false);
    }
  }

  if (!cfg) return null;

  return (
    <div className="admin-drop-band admin-xp-block">
      <p className="muted">{t("adminMapGlobalsHint")}</p>
      <div className="admin-drop-levels">
        <HoverHint as="span" title={t("adminMapRefresh")} text={t("adminMapRefreshHint")}>
          <label>
            {t("adminMapRefresh")}
            <input
              type="number"
              min={1}
              max={10080}
              value={cfg.refreshMinutes}
              onChange={(e) => {
                setCfg({ ...cfg, refreshMinutes: Math.max(1, Math.trunc(Number(e.target.value) || 1)) });
                setNote("");
              }}
            />
          </label>
        </HoverHint>
        <HoverHint as="span" title={t("adminMapElite")} text={t("adminMapEliteHint")}>
          <label>
            {t("adminMapElite")}
            <span className="admin-drop-levels">
              <input
                type="number"
                min={1}
                max={4}
                value={cfg.eliteMin}
                onChange={(e) => {
                  const eliteMin = Math.min(4, Math.max(1, Math.trunc(Number(e.target.value) || 1)));
                  setCfg({ ...cfg, eliteMin, eliteMax: Math.max(eliteMin, cfg.eliteMax) });
                  setNote("");
                }}
              />
              <span className="muted">{t("adminDropsLevelTo")}</span>
              <input
                type="number"
                min={1}
                max={4}
                value={cfg.eliteMax}
                onChange={(e) => {
                  const eliteMax = Math.min(4, Math.max(1, Math.trunc(Number(e.target.value) || 1)));
                  setCfg({ ...cfg, eliteMax, eliteMin: Math.min(cfg.eliteMin, eliteMax) });
                  setNote("");
                }}
              />
            </span>
          </label>
        </HoverHint>
        <HoverHint as="span" title={t("adminMapMystery")} text={t("adminMapMysteryHint")}>
          <label>
            {t("adminMapMystery")}
            <span className="admin-drop-levels">
              <input
                type="number"
                min={0}
                max={8}
                value={cfg.mysteryMin}
                onChange={(e) => {
                  const mysteryMin = Math.min(8, Math.max(0, Math.trunc(Number(e.target.value) || 0)));
                  setCfg({ ...cfg, mysteryMin, mysteryMax: Math.max(mysteryMin, cfg.mysteryMax) });
                  setNote("");
                }}
              />
              <span className="muted">{t("adminDropsLevelTo")}</span>
              <input
                type="number"
                min={0}
                max={8}
                value={cfg.mysteryMax}
                onChange={(e) => {
                  const mysteryMax = Math.min(8, Math.max(0, Math.trunc(Number(e.target.value) || 0)));
                  setCfg({ ...cfg, mysteryMax, mysteryMin: Math.min(cfg.mysteryMin, mysteryMax) });
                  setNote("");
                }}
              />
            </span>
          </label>
        </HoverHint>
        <HoverHint as="span" title={t("adminMapCamp")} text={t("adminMapCampHint")}>
          <label>
            {t("adminMapCamp")}
            <span className="admin-drop-levels">
              <input
                type="number"
                min={1}
                max={2}
                value={cfg.campMin}
                onChange={(e) => {
                  const campMin = Math.min(2, Math.max(1, Math.trunc(Number(e.target.value) || 1)));
                  setCfg({ ...cfg, campMin, campMax: Math.max(campMin, cfg.campMax) });
                  setNote("");
                }}
              />
              <span className="muted">{t("adminDropsLevelTo")}</span>
              <input
                type="number"
                min={1}
                max={2}
                value={cfg.campMax}
                onChange={(e) => {
                  const campMax = Math.min(2, Math.max(1, Math.trunc(Number(e.target.value) || 1)));
                  setCfg({ ...cfg, campMax, campMin: Math.min(cfg.campMin, campMax) });
                  setNote("");
                }}
              />
            </span>
          </label>
        </HoverHint>
        <HoverHint as="span" title={t("adminMapCampCoins")} text={t("adminMapCampCoinsHint")}>
          <label>
            {t("adminMapCampCoins")}
            <input
              type="number"
              min={0}
              max={1000000}
              value={cfg.campCoins}
              onChange={(e) => {
                setCfg({ ...cfg, campCoins: Math.max(0, Math.trunc(Number(e.target.value) || 0)) });
                setNote("");
              }}
            />
          </label>
        </HoverHint>
        <HoverHint as="span" title={t("adminMapCampDepthMul")} text={t("adminMapCampDepthMulHint")}>
          <label>
            {t("adminMapCampDepthMul")}
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={cfg.campDepthMul}
              onChange={(e) => {
                const n = Number(e.target.value);
                setCfg({ ...cfg, campDepthMul: Number.isFinite(n) && n >= 0 ? n : 0 });
                setNote("");
              }}
            />
          </label>
        </HoverHint>
      </div>
      <div className="admin-drop-actions">
        <button className="gold" disabled={busy} onClick={() => void save()}>
          {t("adminDropsSave")}
        </button>
        {note ? <span className="muted">{note}</span> : null}
      </div>
    </div>
  );
}

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

function MapPanel({ setErr }: { setErr: (s: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="admin-drops">
      <p className="muted">{t("adminMapHint")}</p>
      <MapGlobalsPanel setErr={setErr} />
      <PacksPanel setErr={setErr} />
      <MinesPanel setErr={setErr} />
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
  value_by_rarity: Record<string, number>;
  base_stats: Record<string, number>;
  stats_by_rarity?: Record<string, Record<string, number>>;
  i18n: Record<"en" | "ru" | "zh", ItemLocale>;
};

const EMPTY_LOCALE: ItemLocale = { name: "", flavor: "" };
const EMPTY_RARITY_STATS = (): Record<string, Record<string, number>> =>
  Object.fromEntries(RARITIES.map((r) => [r, {}]));
const EMPTY_RARITY_VALUES = (): Record<string, number> => Object.fromEntries(RARITIES.map((r) => [r, 0]));
const EMPTY_ITEM: AdminItem = {
  id: "",
  slot: "Weapon",
  rarity_min: "Common",
  required_level: 1,
  set_id: null,
  icon: "",
  twohand: false,
  school: "",
  value_by_rarity: EMPTY_RARITY_VALUES(),
  base_stats: {},
  stats_by_rarity: EMPTY_RARITY_STATS(),
  i18n: { en: { ...EMPTY_LOCALE }, ru: { ...EMPTY_LOCALE }, zh: { ...EMPTY_LOCALE } },
};

const SLOT_GLYPH: Record<string, string> = {
  Head: "helm",
  Chest: "chest",
  Gloves: "gloves",
  Legs: "legs",
  Boots: "boots",
  Weapon: "sword",
  Offhand: "shield",
  Neck: "neck",
  Ring1: "ring",
  Ring2: "ring",
};

function previewItem(it: AdminItem, rarity: string, sellPct = 100): Item {
  const stats = it.stats_by_rarity?.[rarity] || it.base_stats || {};
  const sum = Object.values(stats).reduce((a, b) => a + Math.abs(Number(b) || 0), 0);
  const auto = Math.max(4, Math.round(sum * 2.2));
  const priced = Math.max(0, Math.trunc(Number(it.value_by_rarity?.[rarity]) || 0));
  const shop = priced > 0 ? priced : auto;
  const value = Math.max(0, Math.round((shop * sellPct) / 100));
  return {
    id: it.id,
    definition_id: it.id,
    rarity,
    item_level: 1,
    required_level: it.required_level,
    stats,
    affixes: [],
    width: 1,
    height: 1,
    rotated: 0,
    stack: 1,
    grid_x: 0,
    grid_y: 0,
    equip_slot: it.slot,
    location: "INVENTORY",
    value,
    definition: {
      name: it.i18n.en.name || it.id,
      category: it.slot === "Weapon" ? "weapon" : "armor",
      slot: it.slot,
      glyph: SLOT_GLYPH[it.slot || ""] || "stone",
      flavor: it.i18n.en.flavor || "",
      set_id: it.set_id,
      tags: it.school ? ["magic", it.school] : [],
      icon: it.icon,
    },
    set: it.set_id ? { id: it.set_id, name: it.set_id } : null,
  };
}

function ItemsPanel({ setErr }: { setErr: (s: string) => void }) {
  const { t, te, itemName, reloadCatalog } = useI18n();
  const [items, setItems] = useState<AdminItem[]>([]);
  const [sets, setSets] = useState<{ id: string; name: string }[]>([]);
  const [icons, setIcons] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"level" | "name">("level");
  const [edit, setEdit] = useState<AdminItem | null>(null);
  const [rarityTab, setRarityTab] = useState<(typeof RARITIES)[number]>("Common");
  const [hover, setHover] = useState<{ item: Item; x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [sellPct, setSellPct] = useState(100);
  const [sellNote, setSellNote] = useState("");
  const [idLocked, setIdLocked] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const data = await api<{ items: AdminItem[]; sets: { id: string; name: string }[]; icons: string[]; sell_pct?: number }>(
      "/admin/items"
    );
    setItems(data.items);
    setSets(data.sets || []);
    setIcons(data.icons || []);
    if (data.sell_pct != null) setSellPct(data.sell_pct);
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

  const editingListed = !!(edit && idLocked && shown.some((it) => it.id === edit.id));
  useEffect(() => {
    if (!edit) return;
    const t = window.setTimeout(() => {
      requestAnimationFrame(() => scrollEditIntoView(formRef.current));
    }, 0);
    return () => window.clearTimeout(t);
  }, [edit?.id]);

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
          value_by_rarity: edit.value_by_rarity || EMPTY_RARITY_VALUES(),
          base_stats: edit.stats_by_rarity?.Common || edit.base_stats,
          stats_by_rarity: edit.stats_by_rarity || EMPTY_RARITY_STATS(),
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

  async function saveSellPct() {
    if (busy) return;
    setBusy(true);
    try {
      const saved = await api<{ pct: number }>("/admin/sell-pct", { method: "POST", body: { pct: sellPct } });
      setSellPct(saved.pct);
      setSellNote(t("adminItemsSellPctSaved"));
      setErr("");
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "Denied"));
    } finally {
      setBusy(false);
    }
  }

  const itemForm = !edit ? null : (
        <div ref={formRef} className="admin-drop-band admin-item-form">
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
              <input value={edit.icon} onChange={(e) => setEdit({ ...edit, icon: e.target.value })} placeholder="/assets/64x64/sword/sword_01.png" />
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

          <div className="admin-rarity-tabs">
            {RARITIES.map((r) => (
              <button key={r} type="button" className={rarityTab === r ? "gold" : ""} onClick={() => setRarityTab(r)}>
                {t(`rarity_${r}`)}
              </button>
            ))}
          </div>
          <div className="admin-stats-grid">
            <div className="muted">
              {t("adminItemsStats")} · {t(`rarity_${rarityTab}`)}
            </div>
            <HoverHint as="span" title={t("adminItemsValue")} text={t("adminItemsValueHint")}>
              <label>
                {t("adminItemsValue")}
                <input
                  type="number"
                  min={0}
                  value={edit.value_by_rarity?.[rarityTab] ?? 0}
                  onChange={(e) => {
                    const all = { ...(edit.value_by_rarity || EMPTY_RARITY_VALUES()) };
                    all[rarityTab] = Math.max(0, Math.trunc(Number(e.target.value) || 0));
                    setEdit({ ...edit, value_by_rarity: all });
                  }}
                />
              </label>
            </HoverHint>
            {STAT_KEYS.map((k) => (
              <label key={k}>
                {t(`stat_${k}`)}
                <input
                  type="number"
                  step="0.1"
                  value={edit.stats_by_rarity?.[rarityTab]?.[k] || ""}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    const all = { ...(edit.stats_by_rarity || EMPTY_RARITY_STATS()) };
                    const row = { ...(all[rarityTab] || {}) };
                    if (!e.target.value || !Number.isFinite(n)) delete row[k];
                    else row[k] = n;
                    all[rarityTab] = row;
                    setEdit({ ...edit, stats_by_rarity: all, base_stats: rarityTab === "Common" ? row : edit.base_stats });
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
  );

  return (
    <div className="admin-drops" style={{ maxWidth: 1100 }}>
      <p className="muted">{t("adminItemsHint")}</p>
      <div className="admin-drop-band admin-xp-block">
        <div className="admin-drop-levels">
          <label>
            {t("adminItemsSellPct")}
            <input
              type="number"
              min={0}
              max={1000}
              step="1"
              value={sellPct}
              onChange={(e) => {
                setSellPct(Math.max(0, Math.min(1000, Math.trunc(Number(e.target.value) || 0))));
                setSellNote("");
              }}
            />
          </label>
          <span className="muted">{t("adminItemsSellPctHint")}</span>
        </div>
        <div className="admin-drop-actions">
          <button className="gold" disabled={busy} onClick={() => void saveSellPct()}>
            {t("adminDropsSave")}
          </button>
          {sellNote ? <span className="muted">{sellNote}</span> : null}
        </div>
      </div>
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
            setRarityTab("Common");
            setEdit({
              ...EMPTY_ITEM,
              id: `custom_${Date.now().toString(36)}`,
              i18n: { en: { ...EMPTY_LOCALE }, ru: { ...EMPTY_LOCALE }, zh: { ...EMPTY_LOCALE } },
              base_stats: {},
              stats_by_rarity: EMPTY_RARITY_STATS(),
              value_by_rarity: EMPTY_RARITY_VALUES(),
            });
          }}
        >
          {t("adminItemsNew")}
        </button>
      </div>
      {edit && !editingListed ? itemForm : null}
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
              <Fragment key={it.id}>
              <tr className={editingListed && edit?.id === it.id ? "admin-row-editing" : undefined}>
                <td>
                  <div className="admin-item-name">
                    <div
                      className={`cell has-item filled r-${it.rarity_min || "Common"} admin-item-cell`}
                      onMouseEnter={(e) => setHover({ item: previewItem(it, it.rarity_min || "Common", sellPct), x: e.clientX, y: e.clientY })}
                      onMouseMove={(e) => setHover({ item: previewItem(it, it.rarity_min || "Common", sellPct), x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => setHover(null)}
                    >
                      <ItemFace item={previewItem(it, it.rarity_min || "Common", sellPct)} />
                    </div>
                    <div>
                      {itemName(it.id) || it.i18n.ru.name || it.i18n.en.name}
                      <div className="muted">{it.id}</div>
                    </div>
                  </div>
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
                        setRarityTab("Common");
                        setEdit({
                          ...it,
                          value_by_rarity: { ...EMPTY_RARITY_VALUES(), ...(it.value_by_rarity || {}) },
                          i18n: {
                            en: it.i18n?.en || { ...EMPTY_LOCALE },
                            ru: it.i18n?.ru || { ...EMPTY_LOCALE },
                            zh: it.i18n?.zh || { ...EMPTY_LOCALE },
                          },
                          base_stats: it.base_stats || {},
                          stats_by_rarity: {
                            ...EMPTY_RARITY_STATS(),
                            ...(it.stats_by_rarity || {}),
                            Common: it.stats_by_rarity?.Common || it.base_stats || {},
                          },
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
              {edit && editingListed && edit.id === it.id ? (
                <tr className="admin-edit-row">
                  <td colSpan={5}>{itemForm}</td>
                </tr>
              ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {hover ? <ItemTooltip item={hover.item} x={hover.x} y={hover.y} /> : null}
    </div>
  );
}

const ENEMY_KINDS = ["normal", "elite", "boss"] as const;
const ENEMY_GLYPHS = ["bandit", "beast", "knight", "undead", "witch", "cultist", "necromancer", "orc"] as const;
const ENEMY_ABILITIES = ["heavy", "regen", "bleed", "poison", "fire"] as const;

type EnemyLocale = Record<"en" | "ru" | "zh", string>;
type EnemyPotency = {
  regen: number;
  poison: number;
  poisonChance: number;
  bleed: number;
  bleedChance: number;
  fireDmg: number;
  fireHits: number;
  fireChance: number;
  heavyPct: number;
};
type AdminEnemy = {
  id: string;
  kind: string;
  hp: number;
  damage: number;
  armor: number;
  crit_chance: number;
  dodge: number;
  abilities: string[];
  undead: boolean;
  region: number;
  glyph: string;
  icon: string;
  potency: EnemyPotency;
  i18n: EnemyLocale;
};

const EMPTY_POTENCY: EnemyPotency = {
  regen: 2,
  poison: 4,
  poisonChance: 40,
  bleed: 4,
  bleedChance: 40,
  fireDmg: 4,
  fireHits: 3,
  fireChance: 30,
  heavyPct: 20,
};

type XpConfig = { normal: number; elite: number; boss: number; depthMul: number };
const XP_KINDS = ["normal", "elite", "boss"] as const;

const EMPTY_ENEMY: AdminEnemy = {
  id: "",
  kind: "normal",
  hp: 50,
  damage: 8,
  armor: 2,
  crit_chance: 0.05,
  dodge: 0.03,
  abilities: [],
  undead: false,
  region: 1,
  glyph: "bandit",
  icon: "",
  potency: { ...EMPTY_POTENCY },
  i18n: { en: "", ru: "", zh: "" },
};

function EnemiesPanel({ setErr }: { setErr: (s: string) => void }) {
  const { t, te, enemyName, reloadCatalog } = useI18n();
  const [enemies, setEnemies] = useState<AdminEnemy[]>([]);
  const [regions, setRegions] = useState<{ id: number; name: string }[]>([]);
  const [icons, setIcons] = useState<string[]>([]);
  const [xp, setXp] = useState<XpConfig | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"depth" | "name">("depth");
  const [edit, setEdit] = useState<AdminEnemy | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [xpNote, setXpNote] = useState("");
  const [idLocked, setIdLocked] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const data = await api<{
      enemies: AdminEnemy[];
      regions: { id: number; name: string }[];
      icons: string[];
      xp?: XpConfig;
    }>("/admin/enemies");
    setEnemies(data.enemies);
    setRegions(data.regions || []);
    setIcons(data.icons || []);
    setXp(data.xp || { normal: 1, elite: 2, boss: 3, depthMul: 1 });
  }, []);

  useEffect(() => {
    load().catch((e) => setErr(te(e instanceof Error ? e.message : "Denied")));
  }, [load, setErr, te]);

  const shown = enemies
    .filter((e) => {
      const blob = [e.id, e.kind, e.glyph, e.i18n.en, e.i18n.ru, e.i18n.zh, enemyName(e.id, e.i18n.en)].join(" ").toLowerCase();
      return !q.trim() || blob.includes(q.trim().toLowerCase());
    })
    .slice()
    .sort((a, b) =>
      sort === "name"
        ? (a.i18n.ru || a.i18n.en || a.id).localeCompare(b.i18n.ru || b.i18n.en || b.id)
        : a.region - b.region || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)
    );

  const editingListed = !!(edit && idLocked && shown.some((e) => e.id === edit.id));
  useEffect(() => {
    if (!edit) return;
    const t = window.setTimeout(() => {
      requestAnimationFrame(() => scrollEditIntoView(formRef.current));
    }, 0);
    return () => window.clearTimeout(t);
  }, [edit?.id]);

  function patchName(lang: "en" | "ru" | "zh", name: string) {
    if (!edit) return;
    setEdit({ ...edit, i18n: { ...edit.i18n, [lang]: name } });
  }

  function toggleAbility(key: string) {
    if (!edit) return;
    const on = edit.abilities.includes(key);
    setEdit({ ...edit, abilities: on ? edit.abilities.filter((a) => a !== key) : [...edit.abilities, key] });
  }

  function patchPotency(bit: Partial<EnemyPotency>) {
    if (!edit) return;
    setEdit({ ...edit, potency: { ...edit.potency, ...bit } });
  }

  async function uploadArt(file: File) {
    if (!edit) return;
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(new Error("That is not an image."));
      r.readAsDataURL(file);
    });
    const saved = await api<{ path: string }>("/admin/enemies/icon", { method: "POST", body: { data } });
    setEdit({ ...edit, icon: saved.path });
    setIcons((prev) => (prev.includes(saved.path) ? prev : [saved.path, ...prev]));
  }

  async function saveXp() {
    if (!xp || busy) return;
    setBusy(true);
    try {
      const saved = await api<XpConfig>("/admin/xp", { method: "POST", body: xp });
      setXp(saved);
      setXpNote(t("adminEnemiesXpSaved"));
      setErr("");
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "Denied"));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!edit || busy) return;
    setBusy(true);
    try {
      await api("/admin/enemies", {
        method: "POST",
        body: {
          id: edit.id,
          kind: edit.kind,
          region: edit.region,
          glyph: edit.glyph,
          hp: edit.hp,
          damage: edit.damage,
          armor: edit.armor,
          crit_chance: edit.crit_chance,
          dodge: edit.dodge,
          abilities: edit.abilities,
          undead: edit.undead,
          icon: edit.icon,
          potency: edit.potency,
          names: edit.i18n,
        },
      });
      setNote(t("adminEnemiesSaved"));
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
    if (!confirm(t("adminEnemiesDeleteConfirm", { name: enemyName(id, id) || id }))) return;
    setBusy(true);
    try {
      await api("/admin/enemies/delete", { method: "POST", body: { id } });
      if (edit?.id === id) setEdit(null);
      await load();
      await reloadCatalog();
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "Denied"));
    } finally {
      setBusy(false);
    }
  }

  const enemyForm = !edit ? null : (
        <div ref={formRef} className="admin-drop-band admin-item-form">
          <div className="admin-stats-grid">
            <label>
              id
              <input value={edit.id} disabled={idLocked} onChange={(e) => setEdit({ ...edit, id: e.target.value })} />
            </label>
            <label>
              {t("adminEnemiesKind")}
              <select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>
                {ENEMY_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`adminDropsKind${k[0].toUpperCase()}${k.slice(1)}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("adminEnemiesDepth")}
              <select value={edit.region} onChange={(e) => setEdit({ ...edit, region: Number(e.target.value) })}>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("adminEnemiesGlyph")}
              <select value={edit.glyph} onChange={(e) => setEdit({ ...edit, glyph: e.target.value })}>
                {ENEMY_GLYPHS.map((g) => (
                  <option key={g} value={g}>
                    {t(`adminGlyph_${g}`)}
                  </option>
                ))}
                {!ENEMY_GLYPHS.includes(edit.glyph as (typeof ENEMY_GLYPHS)[number]) ? (
                  <option value={edit.glyph}>{edit.glyph}</option>
                ) : null}
              </select>
            </label>
            <label>
              {t("adminEnemiesHp")}
              <input type="number" min={1} value={edit.hp} onChange={(e) => setEdit({ ...edit, hp: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })} />
            </label>
            <label>
              {t("adminEnemiesDamage")}
              <input type="number" min={0} value={edit.damage} onChange={(e) => setEdit({ ...edit, damage: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} />
            </label>
            <label>
              {t("adminEnemiesArmor")}
              <input type="number" min={0} value={edit.armor} onChange={(e) => setEdit({ ...edit, armor: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} />
            </label>
            <label>
              {t("adminEnemiesCrit")}
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={Math.round(edit.crit_chance * 1000) / 10}
                onChange={(e) => setEdit({ ...edit, crit_chance: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })}
              />
            </label>
            <label>
              {t("adminEnemiesDodge")}
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={Math.round(edit.dodge * 1000) / 10}
                onChange={(e) => setEdit({ ...edit, dodge: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })}
              />
            </label>
            <HoverHint as="span" className="admin-check" title={t("adminEnemiesUndead")} text={t("adminAbilityTip_undead")}>
              <label className="admin-check">
                <input type="checkbox" checked={edit.undead} onChange={(e) => setEdit({ ...edit, undead: e.target.checked })} />
                {t("adminEnemiesUndead")}
              </label>
            </HoverHint>
          </div>
          <div>
            <div className="muted">{t("adminEnemiesAbilities")}</div>
            <div className="admin-ability-list">
              {ENEMY_ABILITIES.map((a) => {
                const on = edit.abilities.includes(a);
                return (
                  <div key={a} className={`admin-ability-card${on ? " on" : ""}`}>
                    <HoverHint as="span" title={t(`adminAbility_${a}`)} text={t(`adminAbilityTip_${a}`)}>
                      <label className="admin-check">
                        <input type="checkbox" checked={on} onChange={() => toggleAbility(a)} />
                        {t(`adminAbility_${a}`)}
                      </label>
                    </HoverHint>
                    {on && a === "heavy" ? (
                      <label>
                        {t("adminAbilityHeavy")}
                        <input
                          type="number"
                          min={0}
                          value={edit.potency.heavyPct}
                          onChange={(e) => patchPotency({ heavyPct: Math.max(0, Number(e.target.value) || 0) })}
                        />
                      </label>
                    ) : null}
                    {on && a === "regen" ? (
                      <label>
                        {t("adminAbilityPotency")}
                        <input
                          type="number"
                          min={0}
                          value={edit.potency.regen}
                          onChange={(e) => patchPotency({ regen: Math.max(0, Number(e.target.value) || 0) })}
                        />
                      </label>
                    ) : null}
                    {on && a === "bleed" ? (
                      <>
                        <label>
                          {t("adminAbilityPotency")}
                          <input
                            type="number"
                            min={0}
                            value={edit.potency.bleed}
                            onChange={(e) => patchPotency({ bleed: Math.max(0, Number(e.target.value) || 0) })}
                          />
                        </label>
                        <label>
                          {t("adminAbilityChance")}
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={edit.potency.bleedChance}
                            onChange={(e) => patchPotency({ bleedChance: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                          />
                        </label>
                      </>
                    ) : null}
                    {on && a === "poison" ? (
                      <>
                        <label>
                          {t("adminAbilityPotency")}
                          <input
                            type="number"
                            min={0}
                            value={edit.potency.poison}
                            onChange={(e) => patchPotency({ poison: Math.max(0, Number(e.target.value) || 0) })}
                          />
                        </label>
                        <label>
                          {t("adminAbilityChance")}
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={edit.potency.poisonChance}
                            onChange={(e) => patchPotency({ poisonChance: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                          />
                        </label>
                      </>
                    ) : null}
                    {on && a === "fire" ? (
                      <>
                        <label>
                          {t("adminAbilityPotency")}
                          <input
                            type="number"
                            min={0}
                            value={edit.potency.fireDmg}
                            onChange={(e) => patchPotency({ fireDmg: Math.max(0, Number(e.target.value) || 0) })}
                          />
                        </label>
                        <label>
                          {t("adminAbilityHits")}
                          <input
                            type="number"
                            min={1}
                            value={edit.potency.fireHits}
                            onChange={(e) => patchPotency({ fireHits: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })}
                          />
                        </label>
                        <label>
                          {t("adminAbilityChance")}
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={edit.potency.fireChance}
                            onChange={(e) => patchPotency({ fireChance: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                          />
                        </label>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="admin-icon-row">
            <div className="admin-icon-preview">
              {edit.icon ? <img src={edit.icon} alt="" /> : <span className="muted">{t("adminEnemiesNoArt")}</span>}
            </div>
            <label>
              {t("adminEnemiesArt")}
              <input value={edit.icon} onChange={(e) => setEdit({ ...edit, icon: e.target.value })} placeholder="/assets/mob/..." />
            </label>
            <label className="admin-upload">
              {t("adminItemsUpload")}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadArt(f).catch((err) => setErr(te(err instanceof Error ? err.message : "Denied")));
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
          <div className="admin-i18n">
            {(["en", "ru", "zh"] as const).map((lang) => (
              <div key={lang} className="admin-i18n-col">
                <div className="muted">{lang.toUpperCase()}</div>
                <label>
                  {t("adminItemsName")}
                  <input value={edit.i18n[lang]} onChange={(e) => patchName(lang, e.target.value)} />
                </label>
              </div>
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
  );

  return (
    <div className="admin-drops" style={{ maxWidth: 1100 }}>
      <p className="muted">{t("adminEnemiesHint")}</p>
      {xp ? (
        <div className="admin-drop-band admin-xp-block">
          <div className="section-title">{t("adminEnemiesXpTitle")}</div>
          <p className="muted">{t("adminEnemiesXpHint")}</p>
          <div className="admin-drop-levels">
            {XP_KINDS.map((kind) => (
              <label key={kind}>
                {kind === "normal"
                  ? t("adminDropsKindNormal")
                  : kind === "elite"
                    ? t("adminDropsKindElite")
                    : t("adminDropsKindBoss")}
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={xp[kind]}
                  onChange={(e) => {
                    const n = Math.max(0, Math.trunc(Number(e.target.value) || 0));
                    setXp({ ...xp, [kind]: n });
                    setXpNote("");
                  }}
                />
              </label>
            ))}
            <label>
              {t("adminEnemiesXpDepthMul")}
              <input
                type="number"
                min={0}
                step="0.1"
                value={xp.depthMul}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setXp({ ...xp, depthMul: Number.isFinite(n) && n >= 0 ? n : 0 });
                  setXpNote("");
                }}
              />
            </label>
          </div>
          <div className="admin-drop-actions">
            <button className="gold" disabled={busy} onClick={() => void saveXp()}>
              {t("adminDropsSave")}
            </button>
            {xpNote ? <span className="muted">{xpNote}</span> : null}
          </div>
        </div>
      ) : null}
      <div className="admin-drop-head">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("adminEnemiesSearch")} />
        <button className={sort === "depth" ? "gold" : ""} onClick={() => setSort("depth")}>
          {t("adminEnemiesSortDepth")}
        </button>
        <button className={sort === "name" ? "gold" : ""} onClick={() => setSort("name")}>
          {t("adminEnemiesSortName")}
        </button>
        <button
          className="gold"
          onClick={() => {
            setIdLocked(false);
            setEdit({
              ...EMPTY_ENEMY,
              id: `foe_${Date.now().toString(36)}`,
              region: regions[0]?.id || 1,
              i18n: { en: "", ru: "", zh: "" },
              abilities: [],
              potency: { ...EMPTY_POTENCY },
              icon: "",
            });
          }}
        >
          {t("adminEnemiesNew")}
        </button>
      </div>
      {edit && !editingListed ? enemyForm : null}
      <div className="admin-table-wrap">
        <table className="board-table admin-table">
          <thead>
            <tr>
              <th>{t("name")}</th>
              <th>{t("adminEnemiesKind")}</th>
              <th>{t("adminEnemiesDepth")}</th>
              <th>{t("adminEnemiesHp")}</th>
              <th>{t("adminEnemiesDamage")}</th>
              <th>{t("adminActions")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <Fragment key={e.id}>
              <tr className={editingListed && edit?.id === e.id ? "admin-row-editing" : undefined}>
                <td>
                  {enemyName(e.id, e.i18n.ru || e.i18n.en) || e.i18n.ru || e.i18n.en}
                  <div className="muted">{e.id}</div>
                </td>
                <td>{t(`adminDropsKind${e.kind[0]!.toUpperCase()}${e.kind.slice(1)}`)}</td>
                <td>{e.region}</td>
                <td>{e.hp}</td>
                <td>{e.damage}</td>
                <td>
                  <div className="admin-actions">
                    <button
                      disabled={busy}
                      onClick={() => {
                        setIdLocked(true);
                        setEdit({
                          ...e,
                          i18n: { en: e.i18n?.en || "", ru: e.i18n?.ru || "", zh: e.i18n?.zh || "" },
                          abilities: (e.abilities || []).filter((a) => a !== "strike" && a !== "undead"),
                          icon: e.icon || "",
                          potency: { ...EMPTY_POTENCY, ...(e.potency || {}) },
                        });
                      }}
                    >
                      {t("adminItemsEdit")}
                    </button>
                    <button className="danger" disabled={busy} onClick={() => void remove(e.id)}>
                      {t("adminItemsDelete")}
                    </button>
                  </div>
                </td>
              </tr>
              {edit && editingListed && edit.id === e.id ? (
                <tr className="admin-edit-row">
                  <td colSpan={6}>{enemyForm}</td>
                </tr>
              ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type AdminHero = {
  id: string;
  sort: number;
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
  portrait: string;
  starters: string[];
  i18n: Record<"en" | "ru" | "zh", { name: string; blurb: string }>;
};

function HeroesPanel({ setErr }: { setErr: (s: string) => void }) {
  const { t, te, heroName, itemName, reloadCatalog } = useI18n();
  const [heroes, setHeroes] = useState<AdminHero[]>([]);
  const [icons, setIcons] = useState<string[]>([]);
  const [kitItems, setKitItems] = useState<AdminItem[]>([]);
  const [itemQ, setItemQ] = useState("");
  const [edit, setEdit] = useState<AdminHero | null>(null);
  const [artPick, setArtPick] = useState<"icon" | "portrait">("icon");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [levelXpMul, setLevelXpMul] = useState(1);
  const [xpNote, setXpNote] = useState("");

  const load = useCallback(async () => {
    const data = await api<{ heroes: AdminHero[]; icons: string[]; items: AdminItem[]; levelXpMul?: number }>("/admin/heroes");
    setHeroes(data.heroes.map((h) => ({ ...h, starters: h.starters || [], portrait: h.portrait || "" })));
    setIcons(data.icons || []);
    setKitItems(data.items || []);
    if (typeof data.levelXpMul === "number" && Number.isFinite(data.levelXpMul)) setLevelXpMul(data.levelXpMul);
  }, []);

  useEffect(() => {
    load().catch((e) => setErr(te(e instanceof Error ? e.message : "Denied")));
  }, [load, setErr, te]);

  function patchNum(key: keyof AdminHero, value: number) {
    if (!edit) return;
    setEdit({ ...edit, [key]: value });
    setNote("");
  }

  function patchLocale(lang: "en" | "ru" | "zh", bit: Partial<{ name: string; blurb: string }>) {
    if (!edit) return;
    setEdit({ ...edit, i18n: { ...edit.i18n, [lang]: { ...edit.i18n[lang], ...bit } } });
    setNote("");
  }

  async function uploadArt(file: File) {
    if (!edit) return;
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(new Error("That is not an image."));
      r.readAsDataURL(file);
    });
    const saved = await api<{ path: string }>("/admin/heroes/icon", { method: "POST", body: { data } });
    setEdit({ ...edit, [artPick]: saved.path });
    setIcons((prev) => (prev.includes(saved.path) ? prev : [saved.path, ...prev]));
  }

  async function save() {
    if (!edit || busy) return;
    setBusy(true);
    try {
      const names: Record<string, string> = {};
      const blurbs: Record<string, string> = {};
      for (const lang of ["en", "ru", "zh"] as const) {
        names[lang] = edit.i18n[lang].name;
        blurbs[lang] = edit.i18n[lang].blurb;
      }
      await api("/admin/heroes", {
        method: "POST",
        body: {
          id: edit.id,
          health: edit.health,
          damage: edit.damage,
          armor: edit.armor,
          critChance: edit.critChance,
          critDamage: edit.critDamage,
          dodge: edit.dodge,
          lifesteal: edit.lifesteal,
          luck: edit.luck,
          magicDamage: edit.magicDamage,
          icon: edit.icon,
          portrait: edit.portrait || "",
          starters: edit.starters || [],
          names,
          blurbs,
        },
      });
      setNote(t("adminHeroesSaved"));
      await load();
      await reloadCatalog();
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "Denied"));
    } finally {
      setBusy(false);
    }
  }

  async function saveLevelXp() {
    if (busy) return;
    setBusy(true);
    try {
      const saved = await api<{ mul: number }>("/admin/heroes/level-xp", { method: "POST", body: { mul: levelXpMul } });
      setLevelXpMul(saved.mul);
      setXpNote(t("adminHeroesLevelXpSaved"));
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "Denied"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-drops" style={{ maxWidth: 1100 }}>
      <p className="muted">{t("adminHeroesHint")}</p>
      <div className="admin-drop-band admin-xp-block">
        <div className="admin-drop-levels">
          <label>
            {t("adminHeroesLevelXpMul")}
            <input
              type="number"
              min={0.01}
              step="0.1"
              value={levelXpMul}
              onChange={(e) => {
                const n = Number(e.target.value);
                setLevelXpMul(Number.isFinite(n) && n > 0 ? n : 1);
                setXpNote("");
              }}
            />
          </label>
        </div>
        <p className="muted">{t("adminHeroesLevelXpHint")}</p>
        <div className="admin-drop-actions">
          <button className="gold" disabled={busy} onClick={() => void saveLevelXp()}>
            {t("adminDropsSave")}
          </button>
          {xpNote ? <span className="muted">{xpNote}</span> : null}
        </div>
      </div>
      {edit ? (
        <div className="admin-item-edit">
          <div className="admin-icon-row admin-hero-arts">
            <button
              type="button"
              className={`admin-hero-art-slot${artPick === "portrait" ? " on" : ""}`}
              onClick={() => setArtPick("portrait")}
            >
              <div className="admin-icon-preview hall-art admin-hero-preview">
                <HeroFace icon={edit.portrait} alt={heroName(edit.id)} />
              </div>
              <span>{t("adminHeroesPortrait")}</span>
            </button>
            <button
              type="button"
              className={`admin-hero-art-slot${artPick === "icon" ? " on" : ""}`}
              onClick={() => setArtPick("icon")}
            >
              <div className="admin-icon-preview hall-art admin-hero-preview">
                <HeroFace icon={edit.icon} alt={heroName(edit.id)} />
              </div>
              <span>{t("adminHeroesBattleArt")}</span>
            </button>
            <label>
              {artPick === "portrait" ? t("adminHeroesPortrait") : t("adminHeroesBattleArt")}
              <input
                value={artPick === "portrait" ? edit.portrait : edit.icon}
                onChange={(e) => {
                  setEdit({ ...edit, [artPick]: e.target.value });
                  setNote("");
                }}
                placeholder="/assets/pers/..."
              />
            </label>
            <label className="admin-upload">
              {t("adminItemsUpload")}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadArt(f).catch((err) => setErr(te(err instanceof Error ? err.message : "Denied")));
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
                  className={(artPick === "portrait" ? edit.portrait : edit.icon) === src ? "gold" : ""}
                  title={src}
                  onClick={() => { setEdit({ ...edit, [artPick]: src }); setNote(""); }}
                >
                  <img src={src} alt="" />
                </button>
              ))}
            </div>
          ) : null}
          <div className="admin-i18n">
            {(["en", "ru", "zh"] as const).map((lang) => (
              <div key={lang} className="admin-i18n-col">
                <div className="muted">{lang.toUpperCase()}</div>
                <label>
                  {t("adminItemsName")}
                  <input value={edit.i18n[lang].name} onChange={(e) => patchLocale(lang, { name: e.target.value })} />
                </label>
                <label>
                  {t("adminHeroesBlurb")}
                  <input value={edit.i18n[lang].blurb} onChange={(e) => patchLocale(lang, { blurb: e.target.value })} />
                </label>
              </div>
            ))}
          </div>
          <div className="admin-hero-grid">
            {([
              ["health", edit.health],
              ["damage", edit.damage],
              ["magicDamage", edit.magicDamage],
              ["armor", edit.armor],
              ["critChance", edit.critChance],
              ["critDamage", edit.critDamage],
              ["dodge", edit.dodge],
              ["lifesteal", edit.lifesteal],
              ["luck", edit.luck],
            ] as const).map(([key, value]) => (
              <label key={key}>
                {t(`stat_${key}`)}
                <input
                  type="number"
                  value={value}
                  onChange={(e) => patchNum(key, Number(e.target.value))}
                />
              </label>
            ))}
          </div>
          <div className="muted" style={{ marginTop: 12 }}>{t("adminHeroesStarters")}</div>
          {edit.starters?.length ? (
            <ul className="admin-starter-list">
              {edit.starters.map((id) => {
                const it = kitItems.find((x) => x.id === id);
                return (
                  <li key={id}>
                    {it?.icon ? <img src={it.icon} alt="" /> : <span className="admin-starter-gap" />}
                    <span>{itemName(id) || it?.i18n.ru.name || it?.i18n.en.name || id}</span>
                    <button type="button" disabled={busy} onClick={() => { setEdit({ ...edit, starters: edit.starters.filter((x) => x !== id) }); setNote(""); }}>
                      {t("adminHeroesRemoveItem")}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">{t("adminHeroesNoStarters")}</p>
          )}
          <input
            value={itemQ}
            onChange={(e) => setItemQ(e.target.value)}
            placeholder={t("adminHeroesSearchItems")}
          />
          {itemQ.trim() ? (
            <div className="admin-starter-pick">
              {kitItems
                .filter((it) => {
                  if (edit.starters.includes(it.id)) return false;
                  const blob = [it.id, it.i18n.en.name, it.i18n.ru.name, it.i18n.zh.name, itemName(it.id)].join(" ").toLowerCase();
                  return blob.includes(itemQ.trim().toLowerCase());
                })
                .slice(0, 12)
                .map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    disabled={busy || (edit.starters || []).length >= 16}
                    onClick={() => {
                      setEdit({ ...edit, starters: [...(edit.starters || []), it.id] });
                      setItemQ("");
                      setNote("");
                    }}
                  >
                    {t("adminHeroesAddItem")} · {itemName(it.id) || it.i18n.ru.name || it.i18n.en.name || it.id}
                  </button>
                ))}
            </div>
          ) : null}
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
              <th />
              <th>{t("name")}</th>
              <th>{t("stat_health")}</th>
              <th>{t("stat_damage")}</th>
              <th>{t("stat_armor")}</th>
              <th>{t("stat_critChance")}</th>
              <th>{t("adminActions")}</th>
            </tr>
          </thead>
          <tbody>
            {heroes.map((h) => (
              <tr key={h.id} className={edit?.id === h.id ? "on" : ""}>
                <td>
                  <div className="admin-hero-thumb">
                    <HeroFace icon={h.portrait || h.icon} alt={heroName(h.id)} />
                  </div>
                </td>
                <td>{heroName(h.id, h.i18n.ru?.name || h.i18n.en.name)}</td>
                <td>{h.health}</td>
                <td>{h.damage}</td>
                <td>{h.armor}</td>
                <td>{h.critChance}</td>
                <td>
                  <button type="button" onClick={() => { setEdit({ ...h, starters: h.starters || [], portrait: h.portrait || "" }); setNote(""); setItemQ(""); setArtPick("icon"); }}>
                    {t("adminItemsEdit")}
                  </button>
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
  const [maxDepth, setMaxDepth] = useState(10);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const data = await api<{ version: string; maintenance: boolean; message: string; maxDepth?: number }>("/admin/gate");
    setVersion(data.version);
    setMaintenance(!!data.maintenance);
    setMessage(data.message || "");
    setMaxDepth(Math.max(1, Math.trunc(Number(data.maxDepth) || 10)));
  }, []);

  useEffect(() => {
    load().catch((e) => setErr(te(e instanceof Error ? e.message : "Denied")));
  }, [load, setErr, te]);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const saved = await api<{ version: string; maintenance: boolean; message: string; maxDepth?: number }>("/admin/gate", {
        method: "POST",
        body: { version, maintenance, message, maxDepth },
      });
      setVersion(saved.version);
      setMaintenance(!!saved.maintenance);
      setMessage(saved.message || "");
      setMaxDepth(Math.max(1, Math.trunc(Number(saved.maxDepth) || 10)));
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
      <label>
        {t("adminMaxDepth")}
        <input
          type="number"
          min={1}
          max={99}
          value={maxDepth}
          onChange={(e) => {
            setMaxDepth(Math.max(1, Math.min(99, Math.trunc(Number(e.target.value) || 1))));
            setNote("");
          }}
        />
      </label>
      <p className="muted">{t("adminMaxDepthHint")}</p>
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

type TalentEdit = {
  heroId: string;
  lane: TalentLane;
  tier: number;
  icon: string;
  effect: string;
  stats: Record<string, number>;
  names: Record<"en" | "ru" | "zh", string>;
  descs: Record<"en" | "ru" | "zh", string>;
};

function blankTalent(heroId: string, lane: TalentLane, tier: number, node?: TalentNodeView | null): TalentEdit {
  return {
    heroId,
    lane,
    tier,
    icon: node?.icon || "",
    effect: node?.effect || "",
    stats: { ...(node?.stats || {}) },
    names: {
      en: node?.names.en || "",
      ru: node?.names.ru || "",
      zh: node?.names.zh || "",
    },
    descs: {
      en: node?.descs.en || "",
      ru: node?.descs.ru || "",
      zh: node?.descs.zh || "",
    },
  };
}

function TalentsPanel({ setErr }: { setErr: (s: string) => void }) {
  const { t, te, heroName } = useI18n();
  const [heroId, setHeroId] = useState("");
  const [heroes, setHeroes] = useState<string[]>([]);
  const [tree, setTree] = useState<TalentTreeData>({ taken: [], nodes: [] });
  const [icons, setIcons] = useState<string[]>([]);
  const [effects, setEffects] = useState<string[]>([]);
  const [edit, setEdit] = useState<TalentEdit | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(
    async (id?: string) => {
      const q = id || heroId;
      const data = await api<{
        heroId: string;
        heroes: string[];
        effects: string[];
        nodes: (TalentNodeView & { effect?: string; stats?: Record<string, number> })[];
        icons: string[];
      }>(`/admin/talents${q ? `?hero=${encodeURIComponent(q)}` : ""}`);
      setHeroes(data.heroes || []);
      setHeroId(data.heroId);
      setEffects(data.effects || []);
      setIcons(data.icons || []);
      setTree({ taken: [], nodes: data.nodes || [] });
      return data;
    },
    [heroId]
  );

  useEffect(() => {
    load("").catch((e) => setErr(te(e instanceof Error ? e.message : "Denied")));
    // first load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openSlot(lane: TalentLane, tier: number) {
    const node = tree.nodes.find((n) => n.lane === lane && n.tier === tier) as
      | (TalentNodeView & { effect?: string; stats?: Record<string, number> })
      | undefined;
    setEdit(blankTalent(heroId, lane, tier, node));
    setNote(node ? "" : t("adminTalentsEmpty"));
  }

  async function save() {
    if (!edit || busy) return;
    setBusy(true);
    try {
      await api("/admin/talents", {
        method: "POST",
        body: {
          heroId: edit.heroId,
          lane: edit.lane,
          tier: edit.tier,
          icon: edit.icon,
          effect: edit.effect,
          stats: edit.stats,
          names: edit.names,
          descs: edit.descs,
        },
      });
      setNote(t("adminTalentsSaved"));
      const data = await load(edit.heroId);
      const node = data.nodes.find((n) => n.lane === edit.lane && n.tier === edit.tier);
      if (node) setEdit(blankTalent(edit.heroId, edit.lane, edit.tier, node));
    } catch (e) {
      setErr(te(e instanceof Error ? e.message : "Denied"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!edit || busy) return;
    setBusy(true);
    try {
      await api("/admin/talents/delete", {
        method: "POST",
        body: { heroId: edit.heroId, lane: edit.lane, tier: edit.tier },
      });
      setNote(t("adminTalentsDeleted"));
      await load(edit.heroId);
      setEdit(blankTalent(edit.heroId, edit.lane, edit.tier));
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
      <p className="muted">{t("adminTalentsHint")}</p>
      <label>
        {t("adminTalentsHero")}
        <select
          value={heroId}
          onChange={(e) => {
            const id = e.target.value;
            setEdit(null);
            setNote("");
            void load(id).catch((err) => setErr(te(err instanceof Error ? err.message : "Denied")));
          }}
        >
          {heroes.map((id) => (
            <option key={id} value={id}>
              {heroName(id, id)}
            </option>
          ))}
        </select>
      </label>
      <div className="admin-talent-board">
        <TalentBoard
          tree={tree}
          onSlot={openSlot}
          selected={edit ? { lane: edit.lane, tier: edit.tier } : null}
        />
      </div>
      {edit ? (
        <div className="admin-item-edit">
          <div className="admin-i18n">
            {(["en", "ru", "zh"] as const).map((lang) => (
              <div key={lang} className="admin-i18n-col">
                <div className="muted">{lang.toUpperCase()}</div>
                <label>
                  {t("adminItemsName")}
                  <input
                    value={edit.names[lang]}
                    onChange={(e) => setEdit({ ...edit, names: { ...edit.names, [lang]: e.target.value } })}
                  />
                </label>
                <label>
                  {t("adminItemsFlavor")}
                  <input
                    value={edit.descs[lang]}
                    onChange={(e) => setEdit({ ...edit, descs: { ...edit.descs, [lang]: e.target.value } })}
                  />
                </label>
              </div>
            ))}
          </div>
          <label>
            {t("adminTalentsEffect")}
            <select value={edit.effect} onChange={(e) => setEdit({ ...edit, effect: e.target.value })}>
              {effects.map((id) => (
                <option key={id || "none"} value={id}>
                  {id ? id : t("adminTalentsNoEffect")}
                </option>
              ))}
            </select>
          </label>
          <div className="admin-icon-row">
            <div className="admin-icon-preview">{edit.icon ? <img src={edit.icon} alt="" /> : <span className="muted">{t("adminItemsNoArt")}</span>}</div>
            <label>
              {t("adminItemsIcon")}
              <input value={edit.icon} onChange={(e) => setEdit({ ...edit, icon: e.target.value })} />
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
                <button key={src} type="button" className={edit.icon === src ? "gold" : ""} title={src} onClick={() => setEdit({ ...edit, icon: src })}>
                  <img src={src} alt="" />
                </button>
              ))}
            </div>
          ) : null}
          <div className="admin-stats-grid">
            {STAT_KEYS.map((k) => (
              <label key={k}>
                {t(`stat_${k}`)}
                <input
                  type="number"
                  step="0.1"
                  value={edit.stats[k] || ""}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    const stats = { ...edit.stats };
                    if (!e.target.value || !Number.isFinite(n)) delete stats[k];
                    else stats[k] = n;
                    setEdit({ ...edit, stats });
                  }}
                />
              </label>
            ))}
          </div>
          <div className="admin-drop-actions">
            <button className="gold" disabled={busy} onClick={() => void save()}>
              {t("adminGateSave")}
            </button>
            <button className="danger" disabled={busy} onClick={() => void remove()}>
              {t("adminItemsDelete")}
            </button>
            {note ? <span className="muted">{note}</span> : null}
          </div>
        </div>
      ) : null}
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
  const { t, te, heroName } = useI18n();
  const [tab, setTab] = useState<
    "wayfarers" | "guilds" | "drops" | "shop" | "map" | "items" | "enemies" | "heroes" | "talents" | "gate"
  >("wayfarers");
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
        <button className={tab === "map" ? "gold" : ""} onClick={() => setTab("map")}>
          {t("adminTabMap")}
        </button>
        <button className={tab === "items" ? "gold" : ""} onClick={() => setTab("items")}>
          {t("adminTabItems")}
        </button>
        <button className={tab === "enemies" ? "gold" : ""} onClick={() => setTab("enemies")}>
          {t("adminTabEnemies")}
        </button>
        <button className={tab === "heroes" ? "gold" : ""} onClick={() => setTab("heroes")}>
          {t("adminTabHeroes")}
        </button>
        <button className={tab === "talents" ? "gold" : ""} onClick={() => setTab("talents")}>
          {t("adminTabTalents")}
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
      ) : tab === "map" ? (
        <MapPanel setErr={setErr} />
      ) : tab === "items" ? (
        <ItemsPanel setErr={setErr} />
      ) : tab === "enemies" ? (
        <EnemiesPanel setErr={setErr} />
      ) : tab === "heroes" ? (
        <HeroesPanel setErr={setErr} />
      ) : tab === "talents" ? (
        <TalentsPanel setErr={setErr} />
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
                    {row.character_class ? heroName(row.character_class, row.character_class) : "—"}
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
