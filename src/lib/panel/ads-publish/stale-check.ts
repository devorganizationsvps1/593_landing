/**
 * Bayatlık kontrolleri — saf fonksiyonlar (test edilebilir).
 * (a) status; (c) budget ayrı maddede genişler.
 */

export function normalizeStatus(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase();
}

/** Paketteki current ile Meta canlı status uyuşuyor mu? */
export function isAdStatusStale(opts: {
  packageCurrent: unknown;
  liveStatus: string;
  liveEffectiveStatus?: string | null;
}): boolean {
  const current = normalizeStatus(opts.packageCurrent);
  if (!current) return false;
  const live = normalizeStatus(opts.liveEffectiveStatus || opts.liveStatus);
  if (!live) return false;
  return current !== live;
}

export function statusStaleMessage(opts: {
  packageCurrent: unknown;
  liveStatus: string;
  liveEffectiveStatus?: string | null;
}): string {
  const live = opts.liveEffectiveStatus || opts.liveStatus;
  return `Stale: Meta’daki durum artık ${live}; paketteki current=${String(opts.packageCurrent)}. Yeniden onaya sunun.`;
}
