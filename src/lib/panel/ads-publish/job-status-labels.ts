import type { AdChangeJobStatus, AdChangeStepStatus } from "@prisma/client";

/** Job durumu — succeeded asla "uygulandı" değil. */
export const AD_CHANGE_JOB_STATUS_LABEL: Record<AdChangeJobStatus, string> = {
  queued: "Kuyrukta",
  running: "Çalışıyor",
  waiting: "Bekliyor",
  applied: "Uygulandı (Meta)",
  simulated: "Simüle (yazılmadı)",
  partial: "Kısmi sonuç",
  skipped: "Atlandı",
  succeeded: "Eski kayıt (succeeded — doğrulanmadı)",
  failed: "Hata",
  review: "İnceleme",
};

export const AD_CHANGE_STEP_STATUS_LABEL: Record<AdChangeStepStatus, string> = {
  pending: "Bekliyor",
  running: "Çalışıyor",
  applied: "Uygulandı (Meta)",
  simulated: "Simüle (yazılmadı)",
  succeeded: "Eski kayıt (succeeded — doğrulanmadı)",
  skipped: "Atlandı",
  failed: "Hata",
  waiting: "Bekliyor",
};

export function jobStatusLabel(status: AdChangeJobStatus): string {
  return AD_CHANGE_JOB_STATUS_LABEL[status] ?? status;
}

export function stepStatusLabel(status: AdChangeStepStatus): string {
  return AD_CHANGE_STEP_STATUS_LABEL[status] ?? status;
}

/** Aggregate okurken legacy succeeded → applied sayılmaz; ayrı etiket için. */
export function mapStepStatusForAggregate(
  status: string,
): "applied" | "simulated" | "skipped" | "failed" | "legacy_succeeded" {
  if (status === "succeeded") return "legacy_succeeded";
  if (
    status === "applied" ||
    status === "simulated" ||
    status === "skipped" ||
    status === "failed"
  ) {
    return status;
  }
  return "skipped";
}
