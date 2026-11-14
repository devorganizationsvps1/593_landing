/**
 * Sunucu tarafı Meta yazma izin listesi.
 * Varsayılan boş: hiçbir tür uygulanmaz (eski "deferred" yerine).
 * Kademe bayrakları (K1–K4) açılınca ilgili kind’ler buraya eklenir.
 *
 * deferred kararı eskiden job-runner.applyStep fallthrough’undaydı
 * (bilinmeyen kind → { deferred: true, succeeded }). Artık izin listesinde
 * yoksa adım skipped olur; applied sayılmaz.
 */

export type MetaWriteKind =
  | "ad.status"
  | "adset.status"
  | "adset.daily_budget"
  | "adset.lifetime_budget"
  | "adset.targeting"
  | "adset.placements"
  | "adset.bid"
  | "adset.schedule"
  | "creative.media"
  | "creative.primary_text"
  | "creative.headline"
  | "creative.description"
  | "creative.cta"
  | "creative.link"
  | "creative.url_tags"
  | "creative.page"
  | "creative.instagram";

/** K1 — durdur/başlat/bütçe (bayrak açılınca). */
export const WRITE_KINDS_K1: readonly string[] = [
  "ad.status",
  "adset.status",
  "adset.daily_budget",
];

/** K2 — mevcut reklam düzenleme. */
export const WRITE_KINDS_K2: readonly string[] = [
  "creative.media",
  "creative.primary_text",
  "creative.headline",
  "creative.description",
  "creative.cta",
  "creative.link",
  "creative.url_tags",
  "creative.page",
  "creative.instagram",
  "adset.schedule",
];

/** K3 — oluşturma (ayrı Graph create; şimdilik boş liste). */
export const WRITE_KINDS_K3: readonly string[] = [];

/** K4 — hedefleme / yerleşim / teklif. */
export const WRITE_KINDS_K4: readonly string[] = [
  "adset.targeting",
  "adset.placements",
  "adset.bid",
];

export type WriteTierFlags = {
  /** K1 açık mı — şimdilik her zaman false (tenant kolonu (b) ile gelecek). */
  k1?: boolean;
  k2?: boolean;
  k3?: boolean;
  k4?: boolean;
};

/** Varsayılan boş; yalnızca açık kademelerin türleri. */
export function allowedWriteKinds(flags: WriteTierFlags = {}): Set<string> {
  const out = new Set<string>();
  if (flags.k1) for (const k of WRITE_KINDS_K1) out.add(k);
  if (flags.k2) for (const k of WRITE_KINDS_K2) out.add(k);
  if (flags.k3) for (const k of WRITE_KINDS_K3) out.add(k);
  if (flags.k4) for (const k of WRITE_KINDS_K4) out.add(k);
  return out;
}

export function isWriteKindAllowed(
  kind: string,
  flags: WriteTierFlags = {},
): boolean {
  return allowedWriteKinds(flags).has(kind);
}

export function stepIdempotencyKey(
  kind: string,
  target: {
    adId?: string;
    adsetId?: string;
    campaignId?: string;
  },
): string {
  const id =
    target.adId || target.adsetId || target.campaignId || "account";
  return `${kind}:${id}`;
}
