import { useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n";
import { HoverHint } from "./ui";

export type BattleFoe = {
  id?: string;
  name: string;
  kind: string;
  hp: number;
  maxHp: number;
  damage: number;
  armor?: number;
};

export type BattleAura = {
  armor: number;
  barrier: number;
  thorns: number;
  bleed: number;
  poison: number;
  burn: number;
  frozen: boolean;
};

export type BattleFx = {
  n: number;
  att: string;
  def: string;
  dealt: number;
  crit?: boolean;
  dot?: boolean;
  dodge?: boolean;
  heal?: boolean;
  blocked?: boolean;
};

type Props = {
  playerName: string;
  playerHp: number;
  playerMax: number;
  playerDamage?: number;
  playerAura?: BattleAura;
  foeAuras?: Record<string, BattleAura>;
  foes: BattleFoe[];
  inCity: boolean;
  fx?: BattleFx | null;
};

export function emptyAura(): BattleAura {
  return { armor: 0, barrier: 0, thorns: 0, bleed: 0, poison: 0, burn: 0, frozen: false };
}

export function auraFromStats(stats: Record<string, number> | undefined, armor = 0): BattleAura {
  return {
    armor: Math.max(0, Math.round(stats?.armor ?? armor)),
    barrier: Math.max(0, Math.round(stats?.barrier || 0)),
    thorns: Math.max(0, Math.round(stats?.thorns || 0)),
    bleed: 0,
    poison: 0,
    burn: 0,
    frozen: false,
  };
}

export function applyAuraLine(
  map: Record<string, BattleAura>,
  line: { key?: string; vars?: Record<string, string | number> }
): Record<string, BattleAura> {
  const v = line.vars || {};
  const key = line.key || "";
  const set = (id: string, patch: Partial<BattleAura>) => {
    if (!id) return map;
    return { ...map, [id]: { ...(map[id] || emptyAura()), ...patch } };
  };
  if (key === "combat.strike") {
    const id = String(v.defId || v.id || "");
    const cur = map[id] || emptyAura();
    const patch: Partial<BattleAura> = {};
    if (v.armor != null && v.armor !== "") patch.armor = Number(v.armor);
    else if (Number(v.soak) > 0) patch.armor = Math.max(0, cur.armor - Number(v.soak));
    if (v.barrier != null && v.barrier !== "") patch.barrier = Number(v.barrier);
    if (!Object.keys(patch).length) return map;
    return set(id, patch);
  }
  if (key === "combat.armor") return set(String(v.id || ""), { armor: Number(v.left ?? 0) });
  if (key === "combat.barrier") return set(String(v.id || ""), { barrier: Number(v.left ?? 0) });
  if (key === "combat.thorns") return set(String(v.defId || ""), { thorns: Number(v.left ?? 0) });
  if (key === "combat.poison") return set(String(v.id || ""), { poison: Number(v.n || 0) });
  if (key === "combat.bleed") return set(String(v.id || ""), { bleed: Number(v.n || 0) });
  if (key === "combat.burn") return set(String(v.id || ""), { burn: Number(v.n || 3) });
  if (key === "combat.freeze") return set(String(v.id || ""), { frozen: true });
  if (key === "combat.skip") return set(String(v.id || ""), { frozen: false });
  if (key === "combat.dot") {
    const id = String(v.id || "");
    const patch: Partial<BattleAura> = {};
    if (v.armor != null) patch.armor = Number(v.armor);
    if (v.poison != null) patch.poison = Number(v.poison);
    if (v.bleed != null) patch.bleed = Number(v.bleed);
    if (v.burn != null) patch.burn = Number(v.burn);
    else if (String(v.kind) === "BURN") patch.burn = Math.max(0, (map[id]?.burn || 1) - 1);
    return set(id, patch);
  }
  return map;
}

function FloatNum({ fx, id }: { fx: BattleFx | null; id: string }) {
  const { t } = useI18n();
  if (!fx || fx.def !== id) return null;
  if (fx.dodge) {
    return (
      <div key={fx.n} className="float-dmg dodge">
        {t("aura_dodge")}
      </div>
    );
  }
  if (fx.dealt <= 0) return null;
  return (
    <div
      key={fx.n}
      className={`float-dmg ${fx.heal ? "heal" : ""} ${fx.blocked ? "blocked" : ""} ${fx.crit ? "crit" : ""} ${fx.dot && !fx.heal ? "dot" : ""}`}
    >
      {fx.heal ? `+${fx.dealt}` : fx.dealt}
    </div>
  );
}

function SwordMark() {
  return (
    <svg className="sword-mark" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e8dcc0" strokeWidth="1.8">
      <path d="M14 3 L19 8 L10 17 L6 19 L8 15 Z M9 14 L6 11" />
    </svg>
  );
}

function AuraIcon({ kind }: { kind: string }) {
  const s = { width: 12, height: 12, viewBox: "0 0 24 24", fill: "none" as const, strokeWidth: 2 };
  if (kind === "armor") return <svg {...s} stroke="#c8c4bc"><path d="M12 3 L20 6 V12 C20 17 12 21 12 21 C12 21 4 17 4 12 V6 Z" /></svg>;
  if (kind === "barrier") return <svg {...s} stroke="#8ec8e8"><path d="M12 3 L20 8 L16 21 H8 L4 8 Z" /></svg>;
  if (kind === "thorns") return <svg {...s} stroke="#9ec87a"><path d="M12 21 L12 8 M12 8 L6 3 M12 8 L18 3" /></svg>;
  if (kind === "bleed") return <svg {...s} stroke="#e07070"><path d="M12 3 C12 3 6 11 6 16 C6 19.3 8.7 21 12 21 C15.3 21 18 19.3 18 16 C18 11 12 3 12 3 Z" /></svg>;
  if (kind === "poison") return <svg {...s} stroke="#7ecb6a"><path d="M10 4 H14 V8 L17 18 H7 L10 8 Z" /></svg>;
  if (kind === "burn") return <svg {...s} stroke="#e8a050"><path d="M12 21 C8 21 7 16 10 13 C10 16 14 16 14 12 C18 15 16 21 12 21 Z M12 13 C11 9 13 7 12 4" /></svg>;
  return <svg {...s} stroke="#9ad0e8"><path d="M12 3 L14 8 L19 8 L15 12 L17 18 L12 14 L7 18 L9 12 L5 8 L10 8 Z" /></svg>;
}

const AURA_KEYS = ["armor", "barrier", "thorns", "bleed", "poison", "burn"] as const;

function AuraRow({ aura }: { aura?: BattleAura }) {
  const { t } = useI18n();
  const prev = useRef<BattleAura | undefined>(undefined);
  const [pops, setPops] = useState<Partial<Record<string, { d: number; id: number }>>>({});
  const seq = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!aura) return;
    const before = prev.current;
    prev.current = aura;
    if (!before) return;
    for (const k of AURA_KEYS) {
      const d = aura[k] - before[k];
      if (!d) continue;
      const id = ++seq.current;
      setPops((cur) => ({ ...cur, [k]: { d, id } }));
      window.setTimeout(() => {
        if (!mounted.current) return;
        setPops((cur) => (cur[k]?.id === id ? { ...cur, [k]: undefined } : cur));
      }, 900);
    }
  }, [aura]);

  if (!aura) return null;
  const buffs: { kind: (typeof AURA_KEYS)[number]; n: number; label: string }[] = [];
  const debs: { kind: string; n: number; label: string }[] = [];
  if (aura.armor > 0 || pops.armor) buffs.push({ kind: "armor", n: aura.armor, label: t("stat_armor") });
  if (aura.barrier > 0 || pops.barrier) buffs.push({ kind: "barrier", n: aura.barrier, label: t("stat_barrier") });
  if (aura.thorns > 0 || pops.thorns) buffs.push({ kind: "thorns", n: aura.thorns, label: t("stat_thorns") });
  if (aura.bleed > 0 || pops.bleed) debs.push({ kind: "bleed", n: aura.bleed, label: t("stat_bleed") });
  if (aura.poison > 0 || pops.poison) debs.push({ kind: "poison", n: aura.poison, label: t("stat_poison") });
  if (aura.burn > 0 || pops.burn) debs.push({ kind: "burn", n: aura.burn, label: t("aura_burn") });
  if (aura.frozen) debs.push({ kind: "frozen", n: 1, label: t("aura_frozen") });
  if (!buffs.length && !debs.length) return null;

  const pip = (b: { kind: string; n: number; label: string }, cls: string) => {
    const pop = pops[b.kind];
    return (
      <HoverHint
        key={b.kind}
        as="span"
        className={cls}
        title={b.label}
        text={t(`auraTip_${b.kind}`)}
      >
        <AuraIcon kind={b.kind} />
        {b.kind !== "frozen" && b.n > 0 ? <em>{b.n}</em> : null}
        {pop ? <i className={`aura-pop ${pop.d > 0 ? "up" : "down"}`}>{pop.d > 0 ? `+${pop.d}` : pop.d}</i> : null}
      </HoverHint>
    );
  };

  return (
    <div className="battle-auras">
      {buffs.map((b) => pip(b, "aura buff"))}
      {debs.map((b) => pip(b, `aura debuff d-${b.kind}`))}
    </div>
  );
}

export function BattleStage({ playerName, playerHp, playerMax, playerDamage, playerAura, foeAuras, foes, inCity, fx }: Props) {
  const { t, enemyName } = useI18n();
  const [pulse, setPulse] = useState<BattleFx | null>(null);

  useEffect(() => {
    if (!fx) {
      setPulse(null);
      return;
    }
    setPulse(null);
    const a = requestAnimationFrame(() => {
      requestAnimationFrame(() => setPulse(fx));
    });
    return () => cancelAnimationFrame(a);
  }, [fx]);

  const playerStriking = pulse && !pulse.dot && !pulse.heal && !pulse.dodge && pulse.att === "player";
  const playerHurt = pulse && !pulse.heal && !pulse.dodge && pulse.def === "player";

  return (
    <div className="battle-stage">
      <div className="battle-field">
        <div className="battle-side player-side">
          <div className="stub-host">
            <FloatNum fx={pulse} id="player" />
            <div
              className={`stub player-stub ${playerStriking ? "striking" : ""} ${playerHurt ? "hurt" : ""}`}
              title={playerName}
            />
          </div>
          <div className="foe-meta">
            {playerDamage != null ? (
              <div className="foe-strike foe-strike-right">
                <SwordMark />
                <span>{playerDamage}</span>
              </div>
            ) : null}
            <div className="foe-hp">
              <div className="hpbar hero">
                <span style={{ width: `${Math.max(0, Math.min(100, (playerHp / Math.max(1, playerMax)) * 100))}%` }} />
                <em>
                  {playerHp}/{playerMax}
                </em>
              </div>
              <AuraRow aura={playerAura} />
            </div>
          </div>
        </div>
        <div className="battle-side foe-side">
          {inCity ? (
            <p className="muted battle-safe">{t("safeGround")}</p>
          ) : !foes.length ? (
            <div className="foe-card waiting">
              <div className="stub enemy-stub k-normal" />
            </div>
          ) : (
            foes.map((f, i) => {
              const max = Math.max(1, f.maxHp || f.hp);
              const label = enemyName(f.id, f.name) || f.name;
              const id = String(f.id || f.name);
              const striking = pulse && !pulse.dot && !pulse.heal && !pulse.dodge && pulse.att === id;
              const hurt = pulse && !pulse.heal && !pulse.dodge && pulse.def === id;
              return (
                <div key={`${id}-${i}`} className={`foe-card ${f.hp <= 0 ? "dead" : ""}`}>
                  <div className="stub-host">
                    <FloatNum fx={pulse} id={id} />
                    <div className={`stub enemy-stub k-${f.kind} ${striking ? "striking" : ""} ${hurt ? "hurt" : ""}`} title={label} />
                  </div>
                  <div className="foe-meta">
                    <div className="foe-strike">
                      <SwordMark />
                      <span>{f.damage}</span>
                    </div>
                    <div className="foe-hp">
                      <div className="hpbar">
                        <span style={{ width: `${Math.max(0, Math.min(100, (Math.max(0, f.hp) / max) * 100))}%` }} />
                        <em>
                          {Math.max(0, f.hp)}/{max}
                        </em>
                      </div>
                      <AuraRow aura={foeAuras?.[id]} />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
