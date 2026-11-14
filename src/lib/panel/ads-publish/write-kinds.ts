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

function targetEntityKey(target: {
  adId?: string;
  adsetId?: string;
  campaignId?: string;
}): string {
  if (target.adId) return `ad:${target.adId}`;
  if (target.adsetId) return `adset:${target.adsetId}`;
  if (target.campaignId) return `campaign:${target.campaignId}`;
  return "account";
}

/** Deterministik JSON — anahtar sırası sabit. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * Adım tekilliği: paket sürümü + hedef varlık + kind + yeni değer.
 * Yeniden denemede aynı girdiler → aynı anahtar.
 */
export function stepIdempotencyKey(opts: {
  versionId: string;
  kind: string;
  target: {
    adId?: string;
    adsetId?: string;
    campaignId?: string;
  };
  proposed: unknown;
}): string {
  return [
    opts.versionId,
    targetEntityKey(opts.target),
    opts.kind,
    stableStringify(opts.proposed),
  ].join("|");
}
