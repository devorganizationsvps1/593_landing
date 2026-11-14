/**
 * (c) Bütçe bayatlığı, günlük bütçe yokluğu, % değişim sınırı, para birimi.
 */
import type { AdChangePayload } from "@/lib/panel/ads-publish/types";
import { fetchLiveAdsetSnapshot } from "@/lib/integrations/meta/write";
import {
  budgetDeltaPct,
  budgetMaxDeltaPct,
  budgetsEqualMetaMinor,
  isBudgetDeltaWithinLimit,
  packageBudgetToMetaMinor,
  parseMetaBudgetMinor,
} from "@/lib/panel/ads-publish/budget-units";
import {
  currenciesMismatch,
  currencyMismatchMessage,
} from "@/lib/panel/ads-publish/currency";

export class BudgetCheckError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "stale_budget"
      | "delta_exceeded"
      | "no_daily_budget"
      | "invalid_budget"
      | "currency_mismatch",
  ) {
    super(message);
    this.name = "BudgetCheckError";
  }
}

export function findDailyBudgetChange(payload: AdChangePayload) {
  return payload.changes.find(
    (c) =>
      c.field === "adset.daily_budget" || c.field === "campaign.daily_budget",
  );
}

export function assertBudgetCurrencyAligned(opts: {
  tenantCurrency: string;
  metaCurrency: string;
  payload: AdChangePayload;
}): void {
  if (!findDailyBudgetChange(opts.payload)) return;
  if (!currenciesMismatch(opts.tenantCurrency, opts.metaCurrency)) return;
  throw new BudgetCheckError(
    currencyMismatchMessage(opts.tenantCurrency, opts.metaCurrency),
    "currency_mismatch",
  );
}

/** Saf: paket current vs canlı minor — bayat mı? */
export function isBudgetStale(opts: {
  packageCurrentMinor: number | null;
  liveDailyBudgetMinor: number | null;
}): boolean {
  if (opts.packageCurrentMinor === null) return false;
  if (opts.liveDailyBudgetMinor === null) return true; // set’te günlük yok / değişmiş
  return !budgetsEqualMetaMinor(
    opts.packageCurrentMinor,
    opts.liveDailyBudgetMinor,
  );
}

export function assertBudgetDeltaAllowed(opts: {
  currentMinor: number;
  proposedMinor: number;
  maxPct?: number;
}): void {
  const maxPct = opts.maxPct ?? budgetMaxDeltaPct();
  if (!isBudgetDeltaWithinLimit(opts.currentMinor, opts.proposedMinor, maxPct)) {
    const pct = budgetDeltaPct(opts.currentMinor, opts.proposedMinor);
    throw new BudgetCheckError(
      `Bütçe değişimi %${pct.toFixed(1)} sınırı aşıyor (maks %${maxPct}).`,
      "delta_exceeded",
    );
  }
}

/** Paket oluşturma / güncelleme — para birimi + % sınırı. */
export function assertPayloadBudgetLimits(
  payload: AdChangePayload,
  opts?: { tenantCurrency?: string; metaCurrency?: string },
): void {
  if (opts) {
    assertBudgetCurrencyAligned({
      tenantCurrency: opts.tenantCurrency || "",
      metaCurrency: opts.metaCurrency || "",
      payload,
    });
  }
  const change = findDailyBudgetChange(payload);
  if (!change) return;
  const currentMinor = packageBudgetToMetaMinor(change.current);
  const proposedMinor = packageBudgetToMetaMinor(change.proposed);
  if (proposedMinor === null) {
    throw new BudgetCheckError("Geçersiz önerilen bütçe.", "invalid_budget");
  }
  if (currentMinor === null || currentMinor <= 0) {
    throw new BudgetCheckError(
      "Mevcut günlük bütçe yok veya geçersiz; değişim yüzdesi hesaplanamaz.",
      "no_daily_budget",
    );
  }
  assertBudgetDeltaAllowed({ currentMinor, proposedMinor });
}

/**
 * Uygulamadan hemen önce: canlı Meta oku.
 * - günlük bütçe yok → ret
 * - bayat (current ≠ live) → ret (yeniden onay)
 * - % sınırı → ret
 */
export async function assertLiveBudgetBeforeApply(
  payload: AdChangePayload,
  opts?: { tenantCurrency?: string; metaCurrency?: string },
): Promise<void> {
  const change = findDailyBudgetChange(payload);
  if (!change) return;
  if (opts) {
    assertBudgetCurrencyAligned({
      tenantCurrency: opts.tenantCurrency || "",
      metaCurrency: opts.metaCurrency || "",
      payload,
    });
  }
  if (!payload.target.adsetId && change.field === "adset.daily_budget") {
    throw new BudgetCheckError(
      "Günlük bütçe adımı için adsetId gerekli.",
      "invalid_budget",
    );
  }

  if (change.field !== "adset.daily_budget" || !payload.target.adsetId) {
    // Kampanya bütçesi live check (d) ile genişler; para birimi yukarıda.
    return;
  }

  const live = await fetchLiveAdsetSnapshot(payload.target.adsetId);
  const liveMinor = parseMetaBudgetMinor(live.daily_budget);

  if (liveMinor === null) {
    throw new BudgetCheckError(
      "Reklam setinde günlük bütçe yok (kampanya düzeyi veya lifetime). Günlük bütçe adımı reddedildi.",
      "no_daily_budget",
    );
  }

  const packageCurrentMinor = packageBudgetToMetaMinor(change.current);
  if (
    isBudgetStale({
      packageCurrentMinor,
      liveDailyBudgetMinor: liveMinor,
    })
  ) {
    throw new BudgetCheckError(
      `Stale bütçe: Meta’da günlük bütçe ${liveMinor} minor; paketteki current=${String(change.current)}. Yeniden onaya sunun.`,
      "stale_budget",
    );
  }

  const proposedMinor = packageBudgetToMetaMinor(change.proposed);
  if (proposedMinor === null) {
    throw new BudgetCheckError("Geçersiz önerilen bütçe.", "invalid_budget");
  }
  assertBudgetDeltaAllowed({
    currentMinor: liveMinor,
    proposedMinor,
  });
}
