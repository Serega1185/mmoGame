import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ERRORS, LANGS, UI, type Lang } from "./ui";
import { ENEMIES, ITEMS, REGIONS, SETS, SKILLS } from "./lore";
import type { Item } from "../api";

const KEY = "ashmarch-lang";

type LocaleBit = { name: string; flavor: string };
type ItemCatalog = Record<string, Record<Lang, LocaleBit>>;

function interp(s: string, vars?: Record<string, string | number>) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

function readLang(): Lang {
  const v = localStorage.getItem(KEY);
  if (v === "en" || v === "ru" || v === "zh") return v;
  const nav = navigator.language.toLowerCase();
  if (nav.startsWith("ru")) return "ru";
  if (nav.startsWith("zh")) return "zh";
  return "en";
}

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  te: (msg: string) => string;
  itemName: (item: Item | string) => string;
  itemFlavor: (item: Item) => string;
  setName: (idOrName: string) => string;
  skillName: (id: string, fallback?: string) => string;
  skillDesc: (id: string, fallback?: string) => string;
  regionName: (id: number, fallback?: string) => string;
  regionTheme: (id: number, fallback?: string) => string;
  regionDesc: (id: number, fallback?: string) => string;
  enemyName: (id: string | undefined, fallback?: string) => string;
  combatLine: (line: { key?: string; vars?: Record<string, string | number>; text: string }) => string;
  reloadCatalog: () => Promise<void>;
};

const I18nCtx = createContext<Ctx | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang);
  const [catalog, setCatalog] = useState<ItemCatalog>({});

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : lang;
    document.title = UI[lang].title;
    document.documentElement.dataset.lang = lang;
  }, [lang]);

  const reloadCatalog = async () => {
    try {
      const res = await fetch("/api/catalog/items", { credentials: "include" });
      const data = (await res.json()) as { items?: ItemCatalog };
      setCatalog(data.items || {});
    } catch {
      /* keep lore fallback */
    }
  };

  useEffect(() => {
    void reloadCatalog();
  }, []);

  const api = useMemo<Ctx>(() => {
    const t = (key: string, vars?: Record<string, string | number>) => interp(UI[lang][key] || UI.en[key] || key, vars);
    const te = (msg: string) => {
      if (msg.startsWith("REQUIRED LEVEL:")) {
        const m = msg.match(/REQUIRED LEVEL:\s*(\d+)\s*YOUR LEVEL:\s*(\d+)/i) || msg.match(/REQUIRED LEVEL:\s*(\d+)/i);
        if (m) return `${t("requiredLevel", { n: m[1]! })}${m[2] ? `  —  ${t("yourLevel", { n: m[2] })}` : ""}`;
      }
      if (msg.startsWith("This belongs in ")) {
        const slot = msg.replace("This belongs in ", "").replace(".", "");
        return lang === "ru" ? `Этому место: ${t("slot_" + slot) || slot}` : lang === "zh" ? `应放在：${t("slot_" + slot) || slot}` : msg;
      }
      return ERRORS[lang][msg] || msg;
    };
    const enemyName = (id: string | undefined, fallback = "") => {
      if (!id || id === "player") return fallback;
      return ENEMIES[id]?.[lang] || fallback;
    };
    const combatant = (id: string | undefined, name: string) => enemyName(String(id), name) || name;
    return {
      lang,
      setLang: (l) => {
        localStorage.setItem(KEY, l);
        setLangState(l);
      },
      t,
      te,
      itemName: (item) => {
        const id = typeof item === "string" ? item : item.definition_id;
        const fb = typeof item === "string" ? item : item.definition.name;
        return catalog[id]?.[lang]?.name || catalog[id]?.en?.name || ITEMS[id]?.[lang]?.[0] || fb;
      },
      itemFlavor: (item) =>
        catalog[item.definition_id]?.[lang]?.flavor ||
        catalog[item.definition_id]?.en?.flavor ||
        ITEMS[item.definition_id]?.[lang]?.[1] ||
        item.definition.flavor,
      setName: (idOrName) => SETS[idOrName]?.[lang]?.[0] || Object.values(SETS).find((s) => s.en[0] === idOrName)?.[lang]?.[0] || idOrName,
      skillName: (id, fallback = id) => SKILLS[id]?.name[lang] || fallback,
      skillDesc: (id, fallback = "") => SKILLS[id]?.desc[lang] || fallback,
      regionName: (id, fallback = "") => REGIONS[id]?.name[lang] || fallback,
      regionTheme: (id, fallback = "") => REGIONS[id]?.theme[lang] || fallback,
      regionDesc: (id, fallback = "") => REGIONS[id]?.desc[lang] || fallback,
      enemyName,
      combatLine: (line) => {
        if (!line.key) return line.text;
        const vars = { ...(line.vars || {}) };
        if (vars.enemyId) vars.enemy = combatant(String(vars.enemyId), String(vars.enemy || ""));
        if (vars.attId) vars.att = combatant(String(vars.attId), String(vars.att || ""));
        if (vars.defId) vars.def = combatant(String(vars.defId), String(vars.def || ""));
        if (vars.id) vars.name = combatant(String(vars.id), String(vars.name || ""));
        if (vars.kind) vars.kind = t(`dot_${vars.kind}`) !== `dot_${vars.kind}` ? t(`dot_${vars.kind}`) : String(vars.kind).toLowerCase();
        const key = line.key.replace(".", "_");
        return t(key, vars as Record<string, string | number>);
      },
      reloadCatalog,
    };
  }, [lang, catalog]);

  return <I18nCtx.Provider value={api}>{children}</I18nCtx.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nCtx);
  if (!ctx) throw new Error("useI18n");
  return ctx;
}

export function LangSwitcher() {
  const { lang, setLang } = useI18n();
  return (
    <div className="lang-switch" role="navigation" aria-label="Language">
      {LANGS.map((l) => (
        <button key={l.id} type="button" className={lang === l.id ? "gold" : ""} onClick={() => setLang(l.id)}>
          {l.label}
        </button>
      ))}
    </div>
  );
}
