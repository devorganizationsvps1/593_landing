/**
 * Adım deneme limiti + artan bekleme + Meta hız limiti.
 * AD_CHANGE_STEP_MAX_ATTEMPTS (varsayılan 5)
 * AD_CHANGE_STEP_BACKOFF_MS_BASE (varsayılan 2000) → base * 2^(attempt-1)
 */
import { MetaGraphError } from "@/lib/integrations/meta/graph";

export function stepMaxAttempts(): number {
  const n = Number(process.env.AD_CHANGE_STEP_MAX_ATTEMPTS || "5");
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 5;
}

export function stepBackoffBaseMs(): number {
  const n = Number(process.env.AD_CHANGE_STEP_BACKOFF_MS_BASE || "2000");
  return Number.isFinite(n) && n >= 100 ? Math.floor(n) : 2000;
}

/** Artan bekleme (attempt 1-based). */
export function stepBackoffMs(attempt: number, baseMs = stepBackoffBaseMs()): number {
  const a = Math.max(1, Math.floor(attempt));
  return baseMs * 2 ** (a - 1);
}

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80004]);

export function isMetaRateLimitError(err: unknown): boolean {
  if (!(err instanceof MetaGraphError)) return false;
  if (err.status === 429) return true;
  if (err.code !== null && RATE_LIMIT_CODES.has(err.code)) return true;
  return /rate limit|too many calls|user request limit/i.test(err.message);
}

/**
 * Meta hız limiti beklemesi: Retry-After saniye / hata mesajındaki saniye /
 * yoksa artan backoff.
 */
export function metaRateLimitWaitMs(
  err: unknown,
  attempt: number,
  retryAfterHeaderSec?: number | null,
): number {
  if (
    retryAfterHeaderSec !== null &&
    retryAfterHeaderSec !== undefined &&
    Number.isFinite(retryAfterHeaderSec) &&
    retryAfterHeaderSec > 0
  ) {
    return Math.ceil(retryAfterHeaderSec) * 1000;
  }
  if (err instanceof MetaGraphError) {
    const fromMsg = err.message.match(/(\d+)\s*sec/i);
    if (fromMsg) {
      const sec = Number(fromMsg[1]);
      if (Number.isFinite(sec) && sec > 0) return sec * 1000;
    }
  }
  return stepBackoffMs(attempt);
}

export type StepAttemptState = {
  attempts: number;
  nextAttemptAt?: string | null;
};

export function readAttemptState(result: unknown): StepAttemptState {
  const r = (result ?? {}) as StepAttemptState;
  return {
    attempts: Number.isFinite(r.attempts) ? Math.max(0, Math.floor(r.attempts)) : 0,
    nextAttemptAt: r.nextAttemptAt ?? null,
  };
}

export function shouldDeferAttempt(
  result: unknown,
  now = new Date(),
): boolean {
  const { nextAttemptAt } = readAttemptState(result);
  if (!nextAttemptAt) return false;
  const t = Date.parse(nextAttemptAt);
  if (!Number.isFinite(t)) return false;
  return t > now.getTime();
}

export function nextAttemptStateAfterFailure(opts: {
  previous: StepAttemptState;
  err: unknown;
  retryAfterHeaderSec?: number | null;
}): { exhausted: boolean; state: StepAttemptState; waitMs: number } {
  const attempts = opts.previous.attempts + 1;
  const max = stepMaxAttempts();
  if (attempts >= max) {
    return {
      exhausted: true,
      waitMs: 0,
      state: { attempts, nextAttemptAt: null },
    };
  }
  const waitMs = isMetaRateLimitError(opts.err)
    ? metaRateLimitWaitMs(opts.err, attempts, opts.retryAfterHeaderSec)
    : stepBackoffMs(attempts);
  return {
    exhausted: false,
    waitMs,
    state: {
      attempts,
      nextAttemptAt: new Date(Date.now() + waitMs).toISOString(),
    },
  };
}
