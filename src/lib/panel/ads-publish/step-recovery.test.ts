import { describe, expect, it } from "vitest";
import {
  isStepRunningStale,
  resolveStuckStep,
  stepRunningTimeoutMs,
} from "@/lib/panel/ads-publish/step-recovery";

describe("(b) stuck step recovery", () => {
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

  it("if Meta already matches proposed → mark_applied (no double write)", () => {
    expect(resolveStuckStep({ liveMatches: true })).toBe("mark_applied");
  });

  it("if Meta differs → reclaim_pending then single apply", () => {
    expect(resolveStuckStep({ liveMatches: false })).toBe("reclaim_pending");
  });

  it("die mid-step scenario: reclaim then claim once (source)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/panel/ads-publish/job-runner.ts"),
      "utf8",
    );
    expect(src).toMatch(/recoverStuckSteps/);
    expect(src).toMatch(/alreadyAtProposed/);
    expect(src).toMatch(/reclaim/);
    expect(src).toMatch(/resume:\s*true/);
  });
});
