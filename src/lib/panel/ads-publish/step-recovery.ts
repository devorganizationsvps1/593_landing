/**
 * Takılı running adım kurtarma.
 * Süre: AD_CHANGE_STEP_RUNNING_TIMEOUT_MS (varsayılan 300000).
 */
import type { AdChangePayload } from "@/lib/panel/ads-publish/types";
import {
  fetchLiveAdSnapshot,
  fetchLiveAdsetSnapshot,
} from "@/lib/integrations/meta/write";
import { normalizeStatus } from "@/lib/panel/ads-publish/stale-check";

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

/** Meta’daki canlı değer, önerilen değere eşit mi? */
export async function liveMatchesProposed(opts: {
  kind: string;
  payload: AdChangePayload;
  proposed: unknown;
}): Promise<boolean> {
  const { kind, payload, proposed } = opts;

  if (kind === "ad.status" && payload.target.adId) {
    const want = normalizeStatus(proposed);
    const live = await fetchLiveAdSnapshot(payload.target.adId);
    const liveStatus = normalizeStatus(live.effective_status || live.status);
    return Boolean(want) && (liveStatus === want || normalizeStatus(live.status) === want);
  }

  if (kind === "adset.status" && payload.target.adsetId) {
    const want = normalizeStatus(proposed);
    const live = await fetchLiveAdsetSnapshot(payload.target.adsetId);
    const liveStatus = normalizeStatus(live.effective_status || live.status);
    return Boolean(want) && (liveStatus === want || normalizeStatus(live.status) === want);
  }

  if (kind === "adset.daily_budget" && payload.target.adsetId) {
    const wantMajor = Number(proposed);
    if (!Number.isFinite(wantMajor)) return false;
    const live = await fetchLiveAdsetSnapshot(payload.target.adsetId);
    const liveMinor = Number(live.daily_budget ?? NaN);
    if (!Number.isFinite(liveMinor)) return false;
    return Math.round(wantMajor * 100) === Math.round(liveMinor);
  }

  // Bilinmeyen kind: güvenli taraf — eşleşmedi say, yeniden uygula.
  return false;
}

export type StuckStepResolution = "mark_applied" | "reclaim_pending";

/**
 * Saf karar: canlı değer önerilene eşitse applied; değilse pending’e al.
 * (Meta okuma ayrı — test edilebilir.)
 */
export function resolveStuckStep(opts: {
  liveMatches: boolean;
}): StuckStepResolution {
  return opts.liveMatches ? "mark_applied" : "reclaim_pending";
}
