import { describe, expect, it } from "vitest";
import { MetaGraphError } from "@/lib/integrations/meta/graph";
import {
  isMetaRateLimitError,
  metaRateLimitWaitMs,
  nextAttemptStateAfterFailure,
  stepBackoffMs,
  stepMaxAttempts,
} from "@/lib/panel/ads-publish/step-retry";

describe("step retry / backoff", () => {
  it("reads max attempts from env", () => {
    const prev = process.env.AD_CHANGE_STEP_MAX_ATTEMPTS;
    process.env.AD_CHANGE_STEP_MAX_ATTEMPTS = "3";
    expect(stepMaxAttempts()).toBe(3);
    process.env.AD_CHANGE_STEP_MAX_ATTEMPTS = prev;
  });

  it("exponential backoff from base", () => {
    expect(stepBackoffMs(1, 2000)).toBe(2000);
    expect(stepBackoffMs(2, 2000)).toBe(4000);
    expect(stepBackoffMs(3, 2000)).toBe(8000);
  });

  it("respects Meta rate-limit wait from message seconds", () => {
    const err = new MetaGraphError("User request limit reached: wait 37 seconds", 400, 17);
    expect(isMetaRateLimitError(err)).toBe(true);
    expect(metaRateLimitWaitMs(err, 1)).toBe(37_000);
  });

  it("uses Retry-After header when provided", () => {
    const err = new MetaGraphError("rate limit", 429, 4);
    expect(metaRateLimitWaitMs(err, 1, 12)).toBe(12_000);
  });

  it("exhausts after max attempts", () => {
    const prev = process.env.AD_CHANGE_STEP_MAX_ATTEMPTS;
    process.env.AD_CHANGE_STEP_MAX_ATTEMPTS = "2";
    const first = nextAttemptStateAfterFailure({
      previous: { attempts: 0 },
      err: new MetaGraphError("rate limit", 429, 17),
    });
    expect(first.exhausted).toBe(false);
    expect(first.state.attempts).toBe(1);
    const second = nextAttemptStateAfterFailure({
      previous: first.state,
      err: new MetaGraphError("rate limit", 429, 17),
    });
    expect(second.exhausted).toBe(true);
    process.env.AD_CHANGE_STEP_MAX_ATTEMPTS = prev;
  });
});
