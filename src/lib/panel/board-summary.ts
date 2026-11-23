/**
 * Üst çubuktaki görev özeti ve panodaki hızlı filtreler için ortak kurallar
 * (sunucu + istemci; veritabanına dokunmaz). Gün sınırı İstanbul saatidir.
 */

const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** İstanbul takvim günü, "YYYY-MM-DD". */
export function istanbulDayKey(d: Date): string {
  return dayKeyFmt.format(d);
}

export function isDoneColumn(columnName: string | null | undefined): boolean {
  return (columnName ?? "").toLocaleLowerCase("tr").includes("tamam");
}

/** Onay bekleyen = "İncelemede" (veya adında "onay" geçen) kolon. */
export function isReviewColumn(columnName: string | null | undefined): boolean {
  const n = (columnName ?? "").toLocaleLowerCase("tr");
  return n.includes("incele") || n.includes("onay");
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = typeof v === "string" ? new Date(v) : v;
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Son tarihi bugün olan, tamamlanmamış kart. */
export function isCardDueToday(opts: {
  dueAt: Date | string | null | undefined;
  columnName?: string | null;
  now?: Date;
}): boolean {
  const due = toDate(opts.dueAt);
  if (!due || isDoneColumn(opts.columnName)) return false;
  return istanbulDayKey(due) === istanbulDayKey(opts.now ?? new Date());
}

/** Son tarihi geçmiş, tamamlanmamış kart (İstanbul gününe göre). */
export function isCardLate(opts: {
  dueAt: Date | string | null | undefined;
  columnName?: string | null;
  now?: Date;
}): boolean {
  const due = toDate(opts.dueAt);
  if (!due || isDoneColumn(opts.columnName)) return false;
  return istanbulDayKey(due) < istanbulDayKey(opts.now ?? new Date());
}

export type TaskSummary = {
  /** "mine": yalnızca bana atananlar; "all": tüm pano (admin). */
  scope: "mine" | "all";
  userId: string | null;
  dueToday: number;
  review: number;
  overdue: number;
};
