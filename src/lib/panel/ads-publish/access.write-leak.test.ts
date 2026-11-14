import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTIONS_THAT_START_JOB,
  EDIT_ONLY_SAFE_ACTIONS,
  isEditOnlySafeAction,
  packageActionStartsJob,
} from "@/lib/panel/ads-publish/write-policy";

function readSrc(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

describe("write-policy: edit-only cannot start Meta jobs", () => {
  it("only approve starts a job", () => {
    expect(ACTIONS_THAT_START_JOB).toEqual(["approve"]);
    expect(packageActionStartsJob("approve")).toBe(true);
    expect(packageActionStartsJob("submit")).toBe(false);
    expect(packageActionStartsJob("save")).toBe(false);
    expect(packageActionStartsJob("reject")).toBe(false);
    expect(packageActionStartsJob("create")).toBe(false);
  });

  it("edit-only safe actions never start jobs", () => {
    for (const action of EDIT_ONLY_SAFE_ACTIONS) {
      expect(isEditOnlySafeAction(action)).toBe(true);
      expect(packageActionStartsJob(action)).toBe(false);
    }
  });
});

describe("source audit: no leak from edit paths", () => {
  it("submitForApproval does not import or call job runner / enqueue", () => {
    const src = readSrc("src/lib/panel/ads-publish/packages.ts");
    const submitIdx = src.indexOf("export async function submitForApproval");
    const decideIdx = src.indexOf("export async function decidePackage");
    expect(submitIdx).toBeGreaterThan(-1);
    expect(decideIdx).toBeGreaterThan(submitIdx);
    const submitBody = src.slice(submitIdx, decideIdx);
    expect(submitBody).not.toMatch(/runAdChangeJob/);
    expect(submitBody).not.toMatch(/enqueueAndRunApprovedJob/);
    expect(submitBody).not.toMatch(/adChangeJob\.create/);
    expect(submitBody).toMatch(/status:\s*"pending"/);
  });

  it("createDraftPackage and updateDraftPackage do not enqueue jobs", () => {
    const src = readSrc("src/lib/panel/ads-publish/packages.ts");
    const createIdx = src.indexOf("export async function createDraftPackage");
    const submitIdx = src.indexOf("export async function submitForApproval");
    const createAndUpdate = src.slice(createIdx, submitIdx);
    expect(createAndUpdate).not.toMatch(/runAdChangeJob/);
    expect(createAndUpdate).not.toMatch(/enqueueAndRunApprovedJob/);
    expect(createAndUpdate).not.toMatch(/adChangeJob\.create/);
  });

  it("only enqueue-approved-job module creates jobs for approve path", () => {
    const enqueue = readSrc(
      "src/lib/panel/ads-publish/enqueue-approved-job.ts",
    );
    expect(enqueue).toMatch(/adChangeJob\.create/);
    expect(enqueue).toMatch(/runAdChangeJob/);

    const packages = readSrc("src/lib/panel/ads-publish/packages.ts");
    expect(packages).toMatch(/enqueueAndRunApprovedJob/);
    // packages itself must not call runAdChangeJob directly
    expect(packages).not.toMatch(/runAdChangeJob/);
  });

  it("no HTTP API imports processQueuedAdChangeJobs", () => {
    const apiFiles = [
      "src/app/api/panel/ads-publish/packages/route.ts",
      "src/app/api/panel/ads-publish/packages/[id]/route.ts",
      "src/app/api/panel/ads-publish/analyze/route.ts",
      "src/app/api/panel/ads-publish/findings/[id]/action/route.ts",
    ];
    for (const rel of apiFiles) {
      const src = readSrc(rel);
      expect(src).not.toMatch(/processQueuedAdChangeJobs/);
      expect(src).not.toMatch(/runAdChangeJob/);
      expect(src).not.toMatch(/enqueueAndRunApprovedJob/);
    }
  });

  it("POST packages route: submit is marked edit-only safe", () => {
    const route = readSrc(
      "src/app/api/panel/ads-publish/packages/[id]/route.ts",
    );
    expect(route).toMatch(/isEditOnlySafeAction/);
    expect(route).toMatch(/packageActionStartsJob/);
  });
});
