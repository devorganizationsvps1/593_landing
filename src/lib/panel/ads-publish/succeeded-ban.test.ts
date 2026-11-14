import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  jobStatusLabel,
  stepStatusLabel,
} from "@/lib/panel/ads-publish/job-status-labels";

describe("(b-close) succeeded must never be written for AdChange job/step", () => {
  it("no AdChange writer assigns status succeeded", () => {
    const files = [
      "src/lib/panel/ads-publish/job-runner.ts",
      "src/lib/panel/ads-publish/enqueue-approved-job.ts",
      "src/lib/panel/ads-publish/packages.ts",
      "src/lib/panel/ads-publish/write-gates.ts",
      "src/lib/panel/ads-publish/step-recovery.ts",
      "src/lib/panel/ads-publish/budget-check.ts",
      "src/lib/integrations/meta/write.ts",
    ].map((f) => resolve(process.cwd(), f));
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      // Prisma data / object writes — not === comparisons for legacy reads
      if (/status:\s*["']succeeded["']/.test(src)) {
        offenders.push(file.replace(process.cwd() + "/", ""));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("job-runner never writes succeeded (source lock)", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/panel/ads-publish/job-runner.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/status:\s*["']succeeded["']/);
    expect(src).toMatch(/status:\s*outcome/);
    expect(src).toMatch(/"applied"/);
    expect(src).toMatch(/"simulated"/);
  });

  it("UI labels: succeeded is not shown as applied", () => {
    expect(jobStatusLabel("succeeded")).not.toMatch(/uygulandı/i);
    expect(stepStatusLabel("succeeded")).not.toMatch(/uygulandı/i);
    expect(jobStatusLabel("succeeded")).toMatch(/eski kayıt/i);
    expect(jobStatusLabel("applied")).toMatch(/uygulandı/i);
  });
});
