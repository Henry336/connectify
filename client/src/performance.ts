import { API_URL } from "./api";

type VitalName = "CLS" | "FCP" | "INP" | "LCP" | "TTFB";

function rating(name: VitalName, value: number) {
  const limits: Record<VitalName, [number, number]> = {
    CLS: [0.1, 0.25],
    FCP: [1_800, 3_000],
    INP: [200, 500],
    LCP: [2_500, 4_000],
    TTFB: [800, 1_800],
  };
  return value <= limits[name][0] ? "good" : value <= limits[name][1] ? "needs-improvement" : "poor";
}

function send(name: VitalName, value: number) {
  const path = window.location.pathname.replace(/\/room\/[^/]+/i, "/room/:code");
  const body = JSON.stringify({ name, value, rating: rating(name, value), path });
  const url = `${API_URL}/api/metrics/vitals`;
  if (navigator.sendBeacon) navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
  else void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
}

export function reportCoreWebVitals() {
  try {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (navigation) send("TTFB", navigation.responseStart);
    const paint = performance.getEntriesByName("first-contentful-paint")[0];
    if (paint) send("FCP", paint.startTime);

    let cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
        if (!entry.hadRecentInput) cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });

    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) send("LCP", last.startTime);
    }).observe({ type: "largest-contentful-paint", buffered: true });

    new PerformanceObserver((list) => {
      const entries = list.getEntries() as Array<PerformanceEntry & { duration: number; interactionId?: number }>;
      const interactions = entries.filter((entry) => entry.interactionId);
      if (interactions.length) send("INP", Math.max(...interactions.map((entry) => entry.duration)));
    }).observe({ type: "event", buffered: true, durationThreshold: 40 } as PerformanceObserverInit);

    addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") send("CLS", cls);
    }, { once: true });
  } catch {
    // Metrics must never affect room behavior on older browsers.
  }
}
