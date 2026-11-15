import { dokployInstances } from "./config";
import { collectAll } from "./monitor";

const INTERVAL_MS = 5 * 60_000;

/** Self-host `next start`: 5 dakikada bir ölçüm + kontrol. */
export function startServerMonitorScheduler() {
  const g = globalThis as typeof globalThis & { __593ServerMonitor?: boolean };
  if (g.__593ServerMonitor) return;
  g.__593ServerMonitor = true;
  const tick = () => {
    if (dokployInstances().length === 0) return;
    collectAll().catch((err) => console.error("[server-monitor]", err));
  };
  setTimeout(tick, 20_000);
  setInterval(tick, INTERVAL_MS);
}
