/**
 * Meta format ve alan uygunluk matrisi — panel ile backend aynı kaynağı kullanır.
 */

export type MetaCreativeFormat =
  | "single_image"
  | "single_video"
  | "carousel"
  | "existing_post"
  | "catalog";

export type MetaFieldLevel = "campaign" | "adset" | "ad" | "creative";

export const META_FORMATS: Array<{
  key: MetaCreativeFormat;
  label: string;
  createAdset: boolean;
  createAd: boolean;
  swapCreative: boolean;
  newVariation: boolean;
  pauseOld: boolean;
  preview: boolean;
}> = [
  {
    key: "single_image",
    label: "Tek görsel",
    createAdset: true,
    createAd: true,
    swapCreative: true,
    newVariation: true,
    pauseOld: true,
    preview: true,
  },
  {
    key: "single_video",
    label: "Tek video",
    createAdset: true,
    createAd: true,
    swapCreative: true,
    newVariation: true,
    pauseOld: true,
    preview: true,
  },
  {
    key: "carousel",
    label: "Carousel",
    createAdset: true,
    createAd: true,
    swapCreative: true,
    newVariation: true,
    pauseOld: true,
    preview: true,
  },
  {
    key: "existing_post",
    label: "Mevcut gönderi",
    createAdset: true,
    createAd: true,
    swapCreative: false,
    newVariation: true,
    pauseOld: true,
    preview: true,
  },
  {
    key: "catalog",
    label: "Katalog",
    createAdset: true,
    createAd: true,
    swapCreative: false,
    newVariation: true,
    pauseOld: true,
    preview: false,
  },
];

export const META_FIELDS: Array<{
  key: string;
  label: string;
  level: MetaFieldLevel;
  /** Kampanya bütçesi varsa reklam seti bütçesi kilitlenir. */
  disableIfCampaignBudget?: boolean;
  budgetKind?: "daily" | "lifetime" | null;
}> = [
  { key: "adset.status", label: "Reklam seti durumu", level: "adset" },
  {
    key: "adset.daily_budget",
    label: "Günlük bütçe",
    level: "adset",
    disableIfCampaignBudget: true,
    budgetKind: "daily",
  },
  {
    key: "adset.lifetime_budget",
    label: "Toplam bütçe",
    level: "adset",
    disableIfCampaignBudget: true,
    budgetKind: "lifetime",
  },
  { key: "adset.targeting", label: "Hedefleme", level: "adset" },
  { key: "adset.placements", label: "Yerleşimler", level: "adset" },
  { key: "adset.bid", label: "Teklif", level: "adset" },
  { key: "adset.schedule", label: "Yayın takvimi", level: "adset" },
  { key: "ad.status", label: "Reklam durumu", level: "ad" },
  { key: "creative.media", label: "Görsel / video", level: "creative" },
  { key: "creative.primary_text", label: "Ana metin", level: "creative" },
  { key: "creative.headline", label: "Başlık", level: "creative" },
  { key: "creative.description", label: "Açıklama", level: "creative" },
  { key: "creative.cta", label: "CTA", level: "creative" },
  { key: "creative.link", label: "Hedef URL", level: "creative" },
  { key: "creative.url_tags", label: "UTM", level: "creative" },
  { key: "creative.page", label: "Facebook Sayfası", level: "creative" },
  { key: "creative.instagram", label: "Instagram kimliği", level: "creative" },
];

export function formatByKey(key: string) {
  return META_FORMATS.find((f) => f.key === key) ?? null;
}

export function fieldByKey(key: string) {
  return META_FIELDS.find((f) => f.key === key) ?? null;
}

/** Bütçe kampanya seviyesindeyse reklam seti bütçe alanları kilitli. */
export function isAdsetBudgetLocked(opts: {
  fieldKey: string;
  campaignHasBudget: boolean;
}): boolean {
  const field = fieldByKey(opts.fieldKey);
  return Boolean(field?.disableIfCampaignBudget && opts.campaignHasBudget);
}
