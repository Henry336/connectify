const viteEnv = (import.meta as ImportMeta & { env?: ImportMetaEnv }).env;
const API_URL = (viteEnv?.VITE_API_URL || "http://localhost:3001").replace(/\/$/, "");

export type ReadyReport = {
  ok: boolean;
  service: string;
  databaseMs: number;
  totalMs: number;
  region?: string;
};

let readinessPromise: Promise<ReadyReport> | null = null;

export function recordClientTiming(name: string, duration: number, detail?: Record<string, unknown>) {
  if (typeof window !== "undefined") {
    try { performance.measure(name, { start: Math.max(0, performance.now() - duration), duration, detail }); }
    catch { /* Older browsers can omit User Timing detail without affecting the action. */ }
    window.dispatchEvent(new CustomEvent("connectify:timing", { detail: { name, duration, ...detail } }));
  }
}

export function warmBackend(): Promise<ReadyReport> {
  if (readinessPromise) return readinessPromise;
  let recentlyReadyAt = 0;
  try { recentlyReadyAt = Number(sessionStorage.getItem("connectify.backendReadyAt") || 0); }
  catch { /* Storage can be unavailable in hardened private-browser modes. */ }
  if (Date.now() - recentlyReadyAt < 60_000) {
    readinessPromise = Promise.resolve({ ok: true, service: "connectify-api", databaseMs: 0, totalMs: 0 });
    return readinessPromise;
  }
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 75_000);
  readinessPromise = fetch(`${API_URL}/ready`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: controller.signal,
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Connectify is still waking up.");
    return data as ReadyReport;
  }).then((report) => {
    try { sessionStorage.setItem("connectify.backendReadyAt", String(Date.now())); }
    catch { /* Readiness still succeeds when browser storage is blocked. */ }
    recordClientTiming("backend:ready", performance.now() - startedAt, { databaseMs: report.databaseMs });
    return report;
  }).catch((error) => {
    readinessPromise = null;
    throw error;
  }).finally(() => window.clearTimeout(timeout));
  return readinessPromise;
}

export async function waitForBackend() {
  try {
    return await warmBackend();
  } catch {
    // The real room request can recover from a transient readiness failure.
    return null;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const startedAt = performance.now();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await response.json().catch(() => ({}));
  recordClientTiming(`api:${init?.method || "GET"}:${path.split("?")[0]}`, performance.now() - startedAt, {
    status: response.status,
    serverTiming: response.headers.get("server-timing"),
  });
  if (!response.ok) throw new Error(data.error || "Could not reach Connectify.");
  return data;
}

export { API_URL };
