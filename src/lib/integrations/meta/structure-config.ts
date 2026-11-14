/**
 * Meta yapı sync hacim sınırları — zamanlayıcı penceresini aşmamak için.
 * Durdurulmuş / üst düzeyden kapalı varlıklar yalnızca son N günde güncellenmişse çekilir.
 * ACTIVE (ve incelemedeki) varlıklar kesilmez.
 */

/** Varsayılan: 180 gün. */
export const DEFAULT_INACTIVE_MAX_AGE_DAYS = 180;

export function metaStructureInactiveMaxAgeDays(): number {
  const raw = (process.env.META_STRUCTURE_INACTIVE_MAX_AGE_DAYS || "").trim();
  if (!raw) return DEFAULT_INACTIVE_MAX_AGE_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_INACTIVE_MAX_AGE_DAYS;
  return Math.floor(n);
}

/** Bu effective_status’lar her zaman sync’e alınır (kesme yok). */
const ALWAYS_SYNC_EFFECTIVE = new Set([
  "ACTIVE",
  "PENDING_REVIEW",
  "PREAPPROVED",
  "PENDING_BILLING_INFO",
  "IN_PROCESS",
  "WITH_ISSUES",
]);

/**
 * Durdurulmuş / üst düzey kapalı — updated_time kesmesine tabi.
 */
export function isInactiveStructureStatus(effectiveStatus: string): boolean {
  const e = effectiveStatus.trim().toUpperCase();
  if (!e) return true;
  if (ALWAYS_SYNC_EFFECTIVE.has(e)) return false;
  if (e === "DELETED" || e === "ARCHIVED") return true; // zaten Graph’tan gelmez
  return true;
}

/** updated_time (ISO veya unix) kesme tarihinden yeni mi? */
export function isWithinInactiveAgeWindow(
  updatedTime: string | number | null | undefined,
  maxAgeDays = metaStructureInactiveMaxAgeDays(),
  nowMs = Date.now(),
): boolean {
  if (updatedTime == null || updatedTime === "") return false;
  let ms: number;
  if (typeof updatedTime === "number") {
    ms = updatedTime < 1e12 ? updatedTime * 1000 : updatedTime;
  } else {
    const t = Date.parse(updatedTime);
    if (Number.isNaN(t)) {
      const asNum = Number(updatedTime);
      if (!Number.isFinite(asNum)) return false;
      ms = asNum < 1e12 ? asNum * 1000 : asNum;
    } else {
      ms = t;
    }
  }
  const cutoff = nowMs - maxAgeDays * 24 * 60 * 60 * 1000;
  return ms >= cutoff;
}

/** Sync’e alınsın mı? */
export function shouldSyncStructureEntity(opts: {
  effectiveStatus: string;
  updatedTime?: string | number | null;
  maxAgeDays?: number;
  nowMs?: number;
}): boolean {
  if (!isInactiveStructureStatus(opts.effectiveStatus)) return true;
  return isWithinInactiveAgeWindow(
    opts.updatedTime,
    opts.maxAgeDays,
    opts.nowMs,
  );
}

/** Mevcut panel ekranları: yalnızca ACTIVE MetaAd satırları (eski sync davranışı). */
export const META_AD_LEGACY_SCREEN_WHERE = {
  effectiveStatus: "ACTIVE",
} as const;
