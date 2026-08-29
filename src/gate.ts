export type GateStatus = {
  version: string;
  maintenance: boolean;
  message: string;
};

const V = "ashmarch.version";
const S = "ashmarch.gate";

function sig(s: GateStatus) {
  return `${s.maintenance ? 1 : 0}\n${s.message}`;
}

export async function fetchStatus(): Promise<GateStatus> {
  const res = await fetch("/api/status", { credentials: "include" });
  const data = (await res.json().catch(() => ({}))) as Partial<GateStatus>;
  return {
    version: String(data.version || "1.0.0"),
    maintenance: !!data.maintenance,
    message: String(data.message || ""),
  };
}

/** Remember status. Returns true if this tab should reload. */
export function rememberGate(s: GateStatus): boolean {
  const prevV = sessionStorage.getItem(V);
  if (prevV && prevV !== s.version) {
    sessionStorage.setItem(V, s.version);
    sessionStorage.setItem(S, sig(s));
    return true;
  }
  sessionStorage.setItem(V, s.version);
  const next = sig(s);
  const prevS = sessionStorage.getItem(S);
  if (prevS != null && prevS !== next) {
    sessionStorage.setItem(S, next);
    return true;
  }
  sessionStorage.setItem(S, next);
  return false;
}
