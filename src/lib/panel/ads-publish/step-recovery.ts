/**
 * Takılı running adım kurtarma.
 * Süre: AD_CHANGE_STEP_RUNNING_TIMEOUT_MS (varsayılan 300000).
 *
 * Üç durum:
 * 1) canlı = önerilen → applied (yeniden yazma yok)
 * 2) canlı = başlangıç (paket current) → reclaim + uygula
 * 3) ikisi de değil → stale → paket yeniden onaya
 */
import type { AdChangePayload } from "@/lib/panel/ads-publish/types";
import {
  fetchLiveAdSnapshot,
  fetchLiveAdsetSnapshot,
} from "@/lib/integrations/meta/write";
import { normalizeStatus } from "@/lib/panel/ads-publish/stale-check";
import {
  budgetsEqualMetaMinor,
  packageBudgetToMetaMinor,
  parseMetaBudgetMinor,
} from "@/lib/panel/ads-publish/budget-units";
import { getCreativeEditMeta } from "@/lib/panel/ads-publish/creative-edit";

export function stepRunningTimeoutMs(): number {
  const n = Number(process.env.AD_CHANGE_STEP_RUNNING_TIMEOUT_MS || "300000");
  return Number.isFinite(n) && n > 0 ? n : 300_000;
}

export function isStepRunningStale(
  startedAt: Date | null | undefined,
  now = new Date(),
  timeoutMs = stepRunningTimeoutMs(),
): boolean {
  if (!startedAt) return false;
  return now.getTime() - startedAt.getTime() >= timeoutMs;
}

export type LiveCompareResult = {
  matchesProposed: boolean;
  matchesInitial: boolean;
};

/** Canlı değeri oku; önerilen / başlangıç ile karşılaştır. */
export async function compareLiveToPackage(opts: {
  kind: string;
  payload: AdChangePayload;
  proposed: unknown;
  initial: unknown;
}): Promise<LiveCompareResult> {
  const { kind, payload, proposed, initial } = opts;

  if (kind === "ad.status" && payload.target.adId) {
    const live = await fetchLiveAdSnapshot(payload.target.adId);
    const liveStatus = normalizeStatus(live.effective_status || live.status);
    const liveAlt = normalizeStatus(live.status);
    const want = normalizeStatus(proposed);
    const start = normalizeStatus(initial);
    return {
      matchesProposed:
        Boolean(want) && (liveStatus === want || liveAlt === want),
      matchesInitial:
        Boolean(start) && (liveStatus === start || liveAlt === start),
    };
  }

  if (kind === "adset.status" && payload.target.adsetId) {
    const live = await fetchLiveAdsetSnapshot(payload.target.adsetId);
    const liveStatus = normalizeStatus(live.effective_status || live.status);
    const liveAlt = normalizeStatus(live.status);
    const want = normalizeStatus(proposed);
    const start = normalizeStatus(initial);
    return {
      matchesProposed:
        Boolean(want) && (liveStatus === want || liveAlt === want),
      matchesInitial:
        Boolean(start) && (liveStatus === start || liveAlt === start),
    };
  }

  if (kind === "adset.daily_budget" && payload.target.adsetId) {
    const live = await fetchLiveAdsetSnapshot(payload.target.adsetId);
    const liveMinor = parseMetaBudgetMinor(live.daily_budget);
    const wantMinor = packageBudgetToMetaMinor(proposed);
    const startMinor = packageBudgetToMetaMinor(initial);
    return {
      matchesProposed:
        liveMinor !== null &&
        wantMinor !== null &&
        budgetsEqualMetaMinor(liveMinor, wantMinor),
      matchesInitial:
        liveMinor !== null &&
        startMinor !== null &&
        budgetsEqualMetaMinor(liveMinor, startMinor),
    };
  }

  if (
    (kind === "creative.bind" || kind === "creative.create") &&
    payload.target.adId
  ) {
    const live = await fetchLiveAdSnapshot(payload.target.adId);
    const liveCid = live.creative?.id || "";
    const meta = getCreativeEditMeta(payload);
    const want =
      meta?.mode === "revert_bind"
        ? meta.restoreCreativeId || ""
        : meta?.newCreativeId || String(proposed || "");
    const start = meta?.currentCreativeId || String(initial || "");
    return {
      matchesProposed: Boolean(want) && liveCid === want,
      matchesInitial: Boolean(start) && liveCid === start,
    };
  }

  return { matchesProposed: false, matchesInitial: false };
}

/** @deprecated use compareLiveToPackage */
export async function liveMatchesProposed(opts: {
  kind: string;
  payload: AdChangePayload;
  proposed: unknown;
}): Promise<boolean> {
  const r = await compareLiveToPackage({
    ...opts,
    initial: null,
  });
  return r.matchesProposed;
}

export type StuckStepResolution =
  | "mark_applied"
  | "reclaim_pending"
  | "stale_reapprove";

export function resolveStuckStep(opts: {
  liveMatchesProposed: boolean;
  liveMatchesInitial: boolean;
}): StuckStepResolution {
  if (opts.liveMatchesProposed) return "mark_applied";
  if (opts.liveMatchesInitial) return "reclaim_pending";
  return "stale_reapprove";
}

export class StuckStaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StuckStaleError";
  }
}
