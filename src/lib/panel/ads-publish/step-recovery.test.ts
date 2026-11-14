import { describe, expect, it } from "vitest";
import {
  isStepRunningStale,
  resolveStuckStep,
  stepRunningTimeoutMs,
} from "@/lib/panel/ads-publish/step-recovery";

describe("(b) stuck step recovery — three outcomes", () => {
  it("timeout comes from AD_CHANGE_STEP_RUNNING_TIMEOUT_MS", () => {
    const prev = process.env.AD_CHANGE_STEP_RUNNING_TIMEOUT_MS;
    process.env.AD_CHANGE_STEP_RUNNING_TIMEOUT_MS = "120000";
    expect(stepRunningTimeoutMs()).toBe(120_000);
    process.env.AD_CHANGE_STEP_RUNNING_TIMEOUT_MS = prev;
  });

  it("running past timeout is stale", () => {
    const started = new Date(Date.now() - 400_000);
    expect(isStepRunningStale(started, new Date(), 300_000)).toBe(true);
    expect(isStepRunningStale(new Date(), new Date(), 300_000)).toBe(false);
  });

  it("live = proposed → mark_applied", () => {
    expect(
      resolveStuckStep({
        liveMatchesProposed: true,
        liveMatchesInitial: false,
      }),
    ).toBe("mark_applied");
    // proposed wins even if also matches initial (already applied)
    expect(
      resolveStuckStep({
        liveMatchesProposed: true,
        liveMatchesInitial: true,
      }),
    ).toBe("mark_applied");
  });

  it("live = initial (not proposed) → reclaim_pending", () => {
    expect(
      resolveStuckStep({
        liveMatchesProposed: false,
        liveMatchesInitial: true,
      }),
    ).toBe("reclaim_pending");
  });

  it("live matches neither → stale_reapprove", () => {
    expect(
      resolveStuckStep({
        liveMatchesProposed: false,
        liveMatchesInitial: false,
      }),
    ).toBe("stale_reapprove");
  });

  it("scheduler scans stuck jobs (source)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const sched = readFileSync(
      resolve(process.cwd(), "src/lib/panel/daily-sync-scheduler.ts"),
      "utf8",
    );
    expect(sched).toMatch(/processQueuedAdChangeJobs/);
    expect(sched).toMatch(/adChangeTick/);
    const runner = readFileSync(
      resolve(process.cwd(), "src/lib/panel/ads-publish/job-runner.ts"),
      "utf8",
    );
    expect(runner).toMatch(/stale_reapprove|StuckStaleError/);
    expect(runner).toMatch(/status:\s*"pending"/); // package re-approve
  });
});
