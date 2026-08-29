import { useEffect, useState } from "react";
import { useI18n } from "./i18n";

export type BattleFoe = {
  id?: string;
  name: string;
  kind: string;
  hp: number;
  maxHp: number;
  damage: number;
};

export type BattleFx = {
  n: number;
  att: string;
  def: string;
  dealt: number;
  crit?: boolean;
  dot?: boolean;
};

type Props = {
  playerName: string;
  playerHp: number;
  playerMax: number;
  foes: BattleFoe[];
  inCity: boolean;
  fx?: BattleFx | null;
};

function SwordMark() {
  return (
    <svg className="sword-mark" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e8dcc0" strokeWidth="1.8">
      <path d="M14 3 L19 8 L10 17 L6 19 L8 15 Z M9 14 L6 11" />
    </svg>
  );
}

export function BattleStage({ playerName, playerHp, playerMax, foes, inCity, fx }: Props) {
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

  const playerStriking = pulse && !pulse.dot && pulse.att === "player";
  const playerHurt = pulse && pulse.def === "player";

  return (
    <div className="battle-stage">
      {pulse && pulse.dealt > 0 ? (
        <div key={pulse.n} className={`float-dmg ${pulse.crit ? "crit" : ""} ${pulse.dot ? "dot" : ""}`}>
          {pulse.dealt}
        </div>
      ) : null}
      <div className="battle-field">
        <div className="battle-side player-side">
          <div
            className={`stub player-stub ${playerStriking ? "striking" : ""} ${playerHurt ? "hurt" : ""}`}
            title={playerName}
          />
          <div className="foe-hp">
            <div className="hpbar hero">
              <span style={{ width: `${Math.max(0, Math.min(100, (playerHp / Math.max(1, playerMax)) * 100))}%` }} />
              <em>
                {playerHp}/{playerMax}
              </em>
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
              const striking = pulse && !pulse.dot && pulse.att === id;
              const hurt = pulse && pulse.def === id;
              return (
                <div key={`${id}-${i}`} className={`foe-card ${f.hp <= 0 ? "dead" : ""}`}>
                  <div className={`stub enemy-stub k-${f.kind} ${striking ? "striking" : ""} ${hurt ? "hurt" : ""}`} title={label} />
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
