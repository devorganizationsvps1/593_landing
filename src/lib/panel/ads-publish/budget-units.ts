/**
 * Meta bütçe birimleri — tek dönüşüm noktası.
 * Graph `daily_budget` / `lifetime_budget` minor unit (kuruş) string/number döner.
 * Panel payload’ı major (TRY) tutabilir; karşılaştırmalar her zaman integer minor ile.
 */

/** Major (TRY) → Meta minor (kuruş). */
export function majorToMetaMinor(major: number): number {
  return Math.round(major * 100);
}

/** Meta minor → major (gösterim). */
export function metaMinorToMajor(minor: number): number {
  return minor / 100;
}

/**
 * Meta Graph alanını integer minor’a çevir.
 * null/undefined/boş → null (günlük bütçe yok).
 */
export function parseMetaBudgetMinor(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

/**
 * Paket alanındaki değeri Meta minor’a çevir.
 * unitHint yoksa: |value| >= 1000 ve tam sayıysa minor varsay; aksi major.
 * (Küçük bütçeler major; Meta’dan kopyalanmış büyük tamsayılar minor olabilir.)
 */
export function packageBudgetToMetaMinor(
  value: unknown,
  unitHint?: "major" | "minor",
): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  if (unitHint === "minor") return Math.round(n);
  if (unitHint === "major") return majorToMetaMinor(n);
  // Varsayılan: panel major kullanır
  return majorToMetaMinor(n);
}

/** Tam sayı eşitliği (Meta biriminde). */
export function budgetsEqualMetaMinor(a: number, b: number): boolean {
  return Math.round(a) === Math.round(b);
}

export function budgetMaxDeltaPct(): number {
  const n = Number(process.env.AD_CHANGE_BUDGET_MAX_DELTA_PCT || "20");
  return Number.isFinite(n) && n > 0 ? n : 20;
}

/**
 * |proposed - current| / current * 100.
 * currentMinor <= 0 → sonsuz değişim (ret için).
 */
export function budgetDeltaPct(currentMinor: number, proposedMinor: number): number {
  if (currentMinor <= 0) return Number.POSITIVE_INFINITY;
  return (Math.abs(proposedMinor - currentMinor) / currentMinor) * 100;
}

export function isBudgetDeltaWithinLimit(
  currentMinor: number,
  proposedMinor: number,
  maxPct = budgetMaxDeltaPct(),
): boolean {
  return budgetDeltaPct(currentMinor, proposedMinor) <= maxPct + 1e-9;
}
