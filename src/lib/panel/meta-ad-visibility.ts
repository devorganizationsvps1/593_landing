/**
 * Eski panel ekranları (Kampanyalar / Bütçe / Meta marka / kurulum):
 * yalnızca effectiveStatus === ACTIVE MetaAd satırları.
 * Kampanya PAUSED iken reklamın status’u ACTIVE olsa bile effective_status
 * genelde CAMPAIGN_PAUSED olur → burada görünmez (eski sync davranışı).
 */

export function isMetaAdVisibleOnLegacyScreens(ad: {
  effectiveStatus?: string | null;
  status?: string | null;
}): boolean {
  return (ad.effectiveStatus || "").trim().toUpperCase() === "ACTIVE";
}
