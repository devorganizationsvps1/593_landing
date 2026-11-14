import type {
  AdChangePackageStatus,
  AdChangePlatform,
  AdChangeSource,
} from "@prisma/client";

export type AdChangeTarget = {
  tenantId: string;
  platform: AdChangePlatform;
  adAccountId: string;
  campaignId?: string;
  adsetId?: string;
  adId?: string;
};

export type AdChangeRationale = {
  dateStart: string;
  dateEnd: string;
  conversionMetric: string;
  spend: number | null;
  conversions: number | null;
  cpa: number | null;
  roas: number | null;
  targetCpa: number | null;
  targetRoas: number | null;
  notes: string;
};

export type AdChangeField = {
  field: string;
  label: string;
  current: unknown;
  proposed: unknown;
  budgetDelta?: number | null;
};

export type AdChangePlanStep = {
  key: string;
  label: string;
  dependsOn?: string;
  waitFor?: "first_impression" | "media_ready" | null;
};

export type AdChangeMedia = {
  kind: "image" | "video";
  name?: string;
  url?: string;
};

/** Durum panosu / içerik takvimi bağlantısı. */
export type AdChangeSourceLink = {
  boardCardId?: string;
  contentPostId?: string;
  cardTitle?: string;
};

export type AdChangePayload = {
  target: AdChangeTarget;
  rationale: AdChangeRationale;
  changes: AdChangeField[];
  plan: AdChangePlanStep[];
  media: AdChangeMedia[];
  source?: AdChangeSourceLink;
};

export const AD_CHANGE_STATUS_LABEL: Record<AdChangePackageStatus, string> = {
  draft: "Taslak",
  pending: "Onay bekliyor",
  rejected: "Reddedildi",
  approved: "Onaylandı",
  applying: "Uygulanıyor",
  applied: "Uygulandı (Meta)",
  simulated: "Simüle (yazılmadı)",
  partial: "Kısmi sonuç",
  skipped: "Atlandı",
  failed: "Hata",
  superseded: "Eski sürüm",
};

export function packageStatusLabel(status: AdChangePackageStatus): string {
  return AD_CHANGE_STATUS_LABEL[status] ?? status;
}

export type AdChangePackageListItem = {
  id: string;
  title: string;
  platform: AdChangePlatform;
  source: AdChangeSource;
  status: AdChangePackageStatus;
  currentVersion: number;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
  /** Simüle/atlanan adımların neden özeti (ekranda). */
  outcomeNote?: string | null;
  /** Running adım zaman aşımını aştı — kurtarma taraması bekleniyor. */
  isStuck?: boolean;
};
