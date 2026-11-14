import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  allowedWriteKinds,
  isWriteKindAllowed,
  stepIdempotencyKey,
  stableStringify,
} from "@/lib/panel/ads-publish/write-kinds";
import {
  isAdStatusStale,
  statusStaleMessage,
} from "@/lib/panel/ads-publish/stale-check";

describe("(a) write-kinds allowlist", () => {
  it("default flags yield empty allowlist — no kind applies", () => {
    const set = allowedWriteKinds({});
    expect(set.size).toBe(0);
    expect(isWriteKindAllowed("ad.status", {})).toBe(false);
    expect(isWriteKindAllowed("adset.daily_budget", {})).toBe(false);
    expect(isWriteKindAllowed("adset.targeting", {})).toBe(false);
  });

  it("K1 flag enables only status and budget kinds", () => {
    expect(isWriteKindAllowed("ad.status", { k1: true })).toBe(true);
    expect(isWriteKindAllowed("adset.status", { k1: true })).toBe(true);
    expect(isWriteKindAllowed("adset.daily_budget", { k1: true })).toBe(true);
    expect(isWriteKindAllowed("creative.headline", { k1: true })).toBe(false);
    expect(isWriteKindAllowed("adset.targeting", { k1: true })).toBe(false);
  });
});

describe("(a) step idempotency key", () => {
  const base = {
    versionId: "ver_1",
    kind: "ad.status",
    target: { adId: "123" },
    proposed: "PAUSED",
  };

  it("is deterministic: version + entity + kind + proposed", () => {
    const a = stepIdempotencyKey(base);
    const b = stepIdempotencyKey({ ...base });
    expect(a).toBe(b);
    expect(a).toBe('ver_1|ad:123|ad.status|"PAUSED"');
  });

  it("retry with same inputs yields same key", () => {
    const first = stepIdempotencyKey(base);
    const retry = stepIdempotencyKey(base);
    expect(retry).toBe(first);
  });

  it("changes when proposed value changes", () => {
    expect(stepIdempotencyKey(base)).not.toBe(
      stepIdempotencyKey({ ...base, proposed: "ACTIVE" }),
    );
  });

  it("stableStringify sorts object keys", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe("(a) status stale check", () => {
  it("detects mismatch between package current and live effective status", () => {
    expect(
      isAdStatusStale({
        packageCurrent: "ACTIVE",
        liveStatus: "PAUSED",
        liveEffectiveStatus: "PAUSED",
      }),
    ).toBe(true);
  });

  it("is not stale when current matches live", () => {
    expect(
      isAdStatusStale({
        packageCurrent: "PAUSED",
        liveStatus: "PAUSED",
        liveEffectiveStatus: "PAUSED",
      }),
    ).toBe(false);
  });

  it("message includes both values", () => {
    const msg = statusStaleMessage({
      packageCurrent: "ACTIVE",
      liveStatus: "PAUSED",
      liveEffectiveStatus: "CAMPAIGN_PAUSED",
    });
    expect(msg).toMatch(/CAMPAIGN_PAUSED/);
    expect(msg).toMatch(/ACTIVE/);
  });
});

describe("(a) claim semantics (documented)", () => {
  it("claim uses updateMany queued→running and pending→running", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/panel/ads-publish/job-runner.ts"),
      "utf8",
    );
    expect(src).toMatch(/claimAdChangeJob/);
    expect(src).toMatch(/claimAdChangeJobStep/);
    expect(src).toMatch(/status:\s*"queued"/);
    expect(src).toMatch(/status:\s*"pending"/);
    expect(src).toMatch(/count === 1/);
    expect(src).not.toMatch(/deferred:\s*true/);
    expect(src).toMatch(/decideStepWrite/);
    expect(src).toMatch(/status:\s*"simulated"/);
  });
});

describe("(a) job-level uniqueness for version", () => {
  it("schema enforces AdChangeJob.versionId unique", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const schema = readFileSync(
      resolve(process.cwd(), "prisma/schema.prisma"),
      "utf8",
    );
    expect(schema).toMatch(/model AdChangeJob[\s\S]*?versionId\s+String\s+@unique/);
  });

  it("enqueue catches P2002 and returns existing job (source)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/panel/ads-publish/enqueue-approved-job.ts"),
      "utf8",
    );
    expect(src).toMatch(/P2002/);
    expect(src).toMatch(/created:\s*false/);
    expect(src).toMatch(/findUnique/);
  });
});

const jobUpdateMany = vi.fn();
const stepUpdateMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    adChangeJob: { updateMany: (...args: unknown[]) => jobUpdateMany(...args) },
    adChangeJobStep: {
      updateMany: (...args: unknown[]) => stepUpdateMany(...args),
    },
  },
}));

describe("(a) concurrent claim — only one winner", () => {
  beforeEach(() => {
    jobUpdateMany.mockReset();
    stepUpdateMany.mockReset();
  });

  it("two concurrent job claims → exactly one true", async () => {
    let calls = 0;
    jobUpdateMany.mockImplementation(async () => {
      calls += 1;
      return { count: calls === 1 ? 1 : 0 };
    });
    const { claimAdChangeJob } = await import(
      "@/lib/panel/ads-publish/job-runner"
    );
    const [a, b] = await Promise.all([
      claimAdChangeJob("job_1"),
      claimAdChangeJob("job_1"),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(jobUpdateMany).toHaveBeenCalledTimes(2);
    expect(jobUpdateMany.mock.calls[0]![0]).toMatchObject({
      where: { id: "job_1", status: "queued" },
      data: { status: "running" },
    });
  });

  it("two concurrent step claims → exactly one true", async () => {
    let calls = 0;
    stepUpdateMany.mockImplementation(async () => {
      calls += 1;
      return { count: calls === 1 ? 1 : 0 };
    });
    const { claimAdChangeJobStep } = await import(
      "@/lib/panel/ads-publish/job-runner"
    );
    const [a, b] = await Promise.all([
      claimAdChangeJobStep("step_1"),
      claimAdChangeJobStep("step_1"),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(stepUpdateMany).toHaveBeenCalledTimes(2);
  });
});

describe("(a) enqueue same version → single job", () => {
  const findUnique = vi.fn();
  const create = vi.fn();

  beforeEach(() => {
    findUnique.mockReset();
    create.mockReset();
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({
      prisma: {
        adChangeJob: {
          findUnique: (...a: unknown[]) => findUnique(...a),
          create: (...a: unknown[]) => create(...a),
          updateMany: vi.fn(),
        },
        adChangeJobStep: { updateMany: vi.fn() },
      },
    }));
    vi.doMock("@/lib/panel/ads-publish/job-runner", () => ({
      runAdChangeJob: vi.fn(async () => undefined),
    }));
  });

  it("second approve request returns same jobId without second create", async () => {
    findUnique.mockResolvedValue({ id: "job_existing", status: "applied" });
    const { enqueueAndRunApprovedJob } = await import(
      "@/lib/panel/ads-publish/enqueue-approved-job"
    );
    const first = await enqueueAndRunApprovedJob({
      packageId: "pkg",
      versionId: "ver_same",
    });
    const second = await enqueueAndRunApprovedJob({
      packageId: "pkg",
      versionId: "ver_same",
    });
    expect(first.jobId).toBe("job_existing");
    expect(second.jobId).toBe("job_existing");
    expect(first.created).toBe(false);
    expect(second.created).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});
