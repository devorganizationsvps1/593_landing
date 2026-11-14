import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("scheduler path uses same gates as approve runner", () => {
  it("processQueuedAdChangeJobs → runAdChangeJob with ownership, gates, stale, budget", () => {
    const runner = readFileSync(
      resolve(process.cwd(), "src/lib/panel/ads-publish/job-runner.ts"),
      "utf8",
    );
    const sched = readFileSync(
      resolve(process.cwd(), "src/lib/panel/daily-sync-scheduler.ts"),
      "utf8",
    );

    expect(sched).toMatch(/processQueuedAdChangeJobs/);
    expect(runner).toMatch(/export async function processQueuedAdChangeJobs/);
    expect(runner).toMatch(/await runAdChangeJob/);

    // Aynı kapılar runAdChangeJob içinde
    expect(runner).toMatch(/assertTargetOwnership/);
    expect(runner).toMatch(/decideStepWrite/);
    expect(runner).toMatch(/assertStatusNotStale/);
    expect(runner).toMatch(/assertLiveBudgetBeforeApply/);
    expect(runner).toMatch(/nextAttemptStateAfterFailure/);
    expect(runner).toMatch(/createPanelNotice/);
  });
});
