/**
 * Onaylanan AdChangeJob yürütücüsü.
 * (a) claim + idempotency + status stale
 * (b) üç kapı, simulated/skipped nedenleri, partial, stuck recovery
 */
import { prisma } from "@/lib/db";
import type { AdChangePayload } from "@/lib/panel/ads-publish/types";
import {
  fetchLiveAdSnapshot,
  updateAdStatus,
  updateAdsetDailyBudget,
  updateAdsetStatus,
} from "@/lib/integrations/meta/write";
import { stepIdempotencyKey } from "@/lib/panel/ads-publish/write-kinds";
import {
  aggregateOutcome,
  decideStepWrite,
  formatMissingGates,
  tierFlagsFromTenant,
  type TenantWriteFlags,
  type WriteGateReason,
} from "@/lib/panel/ads-publish/write-gates";
import {
  isAdStatusStale,
  statusStaleMessage,
} from "@/lib/panel/ads-publish/stale-check";
import {
  isStepRunningStale,
  liveMatchesProposed,
  resolveStuckStep,
  stepRunningTimeoutMs,
} from "@/lib/panel/ads-publish/step-recovery";

function asPayload(raw: unknown): AdChangePayload {
  return (raw ?? {}) as AdChangePayload;
}

function tenantWriteFlags(tenant: {
  metaAdsWriteEnabled?: boolean;
  metaAdsWriteTierK1?: boolean;
  metaAdsWriteTierK2?: boolean;
  metaAdsWriteTierK3?: boolean;
  metaAdsWriteTierK4?: boolean;
}): TenantWriteFlags {
  return {
    metaAdsWriteEnabled: Boolean(tenant.metaAdsWriteEnabled),
    metaAdsWriteTierK1: Boolean(tenant.metaAdsWriteTierK1),
    metaAdsWriteTierK2: Boolean(tenant.metaAdsWriteTierK2),
    metaAdsWriteTierK3: Boolean(tenant.metaAdsWriteTierK3),
    metaAdsWriteTierK4: Boolean(tenant.metaAdsWriteTierK4),
  };
}

export async function claimAdChangeJob(jobId: string): Promise<boolean> {
  const result = await prisma.adChangeJob.updateMany({
    where: { id: jobId, status: "queued" },
    data: { status: "running", startedAt: new Date(), lastError: null },
  });
  return result.count === 1;
}

export async function claimAdChangeJobStep(stepId: string): Promise<boolean> {
  const result = await prisma.adChangeJobStep.updateMany({
    where: { id: stepId, status: "pending" },
    data: { status: "running", startedAt: new Date() },
  });
  return result.count === 1;
}

export async function processQueuedAdChangeJobs(limit = 5): Promise<number> {
  const jobs = await prisma.adChangeJob.findMany({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let n = 0;
  for (const job of jobs) {
    await runAdChangeJob(job.id);
    n++;
  }
  // Takılı running job’ları da kurtar
  const stuck = await prisma.adChangeJob.findMany({
    where: { status: "running" },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true },
  });
  for (const job of stuck) {
    await runAdChangeJob(job.id, { resume: true });
    n++;
  }
  return n;
}

export async function runAdChangeJob(
  jobId: string,
  opts?: { resume?: boolean },
): Promise<void> {
  if (opts?.resume) {
    const running = await prisma.adChangeJob.findFirst({
      where: { id: jobId, status: "running" },
      select: { id: true },
    });
    if (!running) return;
  } else {
    const claimed = await claimAdChangeJob(jobId);
    if (!claimed) return;
  }

  const job = await prisma.adChangeJob.findUnique({
    where: { id: jobId },
    include: {
      package: { include: { tenant: true, createdBy: true } },
      version: true,
      steps: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!job) return;

  const payload = asPayload(job.version.payload);
  const flags = tenantWriteFlags(job.package.tenant);

  await prisma.adChangePackage.update({
    where: { id: job.packageId },
    data: { status: "applying" },
  });

  try {
    await assertStatusNotStale(payload);

    let steps = job.steps;
    if (steps.length === 0) {
      const kinds =
        payload.plan.length > 0
          ? payload.plan.map((p) => p.key)
          : payload.changes.map((c) => c.field);
      const seen = new Set<string>();
      const rows: Array<{
        jobId: string;
        sortOrder: number;
        kind: string;
        idempotencyKey: string;
        dependsOn: string | null;
      }> = [];
      kinds.forEach((kind, i) => {
        const change = payload.changes.find((c) => c.field === kind);
        const key = stepIdempotencyKey({
          versionId: job.versionId,
          kind,
          target: payload.target,
          proposed: change?.proposed ?? null,
        });
        if (seen.has(key)) return;
        seen.add(key);
        rows.push({
          jobId: job.id,
          sortOrder: i,
          kind,
          idempotencyKey: key,
          dependsOn: i > 0 ? kinds[i - 1]! : null,
        });
      });
      if (rows.length) {
        await prisma.adChangeJobStep.createMany({ data: rows });
      }
      steps = await prisma.adChangeJobStep.findMany({
        where: { jobId: job.id },
        orderBy: { sortOrder: "asc" },
      });
    }

    await recoverStuckSteps(steps, payload);

    steps = await prisma.adChangeJobStep.findMany({
      where: { jobId: job.id },
      orderBy: { sortOrder: "asc" },
    });

    for (const step of steps) {
      if (
        step.status === "applied" ||
        step.status === "simulated" ||
        step.status === "skipped" ||
        step.status === "succeeded"
      ) {
        continue;
      }

      const stepClaimed = await claimAdChangeJobStep(step.id);
      if (!stepClaimed) continue;

      try {
        const decision = decideStepWrite(step.kind, flags);

        if (decision.action === "skip") {
          await prisma.adChangeJobStep.update({
            where: { id: step.id },
            data: {
              status: "skipped",
              result: {
                skipped: true,
                missing: decision.missing,
                reasonLabel: formatMissingGates(decision.missing),
                kind: step.kind,
              },
              finishedAt: new Date(),
            },
          });
          continue;
        }

        if (decision.action === "simulate") {
          await prisma.adChangeJobStep.update({
            where: { id: step.id },
            data: {
              status: "simulated",
              result: {
                simulated: true,
                dryRun: true,
                missing: decision.missing,
                reasonLabel: formatMissingGates(decision.missing),
                kind: step.kind,
              },
              finishedAt: new Date(),
            },
          });
          continue;
        }

        // apply — Graph yalnızca burada (allowLive)
        const result = await applyAllowedStep(step.kind, payload, {
          allowLive: true,
        });
        if (result.skipped) {
          await prisma.adChangeJobStep.update({
            where: { id: step.id },
            data: {
              status: "skipped",
              result: result as object,
              finishedAt: new Date(),
            },
          });
          continue;
        }
        await prisma.adChangeJobStep.update({
          where: { id: step.id },
          data: {
            status: result.dryRun ? "simulated" : "applied",
            result: {
              ...(result as object),
              missing: result.dryRun
                ? (["global_META_ADS_WRITE"] as WriteGateReason[])
                : [],
              reasonLabel: result.dryRun
                ? formatMissingGates(["global_META_ADS_WRITE"])
                : "",
            },
            finishedAt: new Date(),
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await prisma.adChangeJobStep.update({
          where: { id: step.id },
          data: {
            status: "failed",
            error: message,
            finishedAt: new Date(),
          },
        });
        throw err;
      }
    }

    const finalSteps = await prisma.adChangeJobStep.findMany({
      where: { jobId: job.id },
      select: { status: true },
    });
    const outcome = aggregateOutcome(
      finalSteps.map((s) => {
        if (s.status === "succeeded") return "applied"; // legacy map for agg only if mixed old — prefer treat as applied? History stays. New code won't write succeeded.
        if (
          s.status === "applied" ||
          s.status === "simulated" ||
          s.status === "skipped" ||
          s.status === "failed"
        ) {
          return s.status;
        }
        return "skipped";
      }),
    );

    await prisma.adChangeJob.update({
      where: { id: job.id },
      data: { status: outcome, finishedAt: new Date() },
    });
    await prisma.adChangePackage.update({
      where: { id: job.packageId },
      data: { status: outcome },
    });

    console.info("[ad_change.job]", job.id, outcome, job.package.title);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.adChangeJob.update({
      where: { id: job.id },
      data: { status: "failed", lastError: message, finishedAt: new Date() },
    });
    await prisma.adChangePackage.update({
      where: { id: job.packageId },
      data: { status: "failed" },
    });
    console.error("[ad_change.job]", job.id, message);
  }
}

async function recoverStuckSteps(
  steps: Array<{
    id: string;
    kind: string;
    status: string;
    startedAt: Date | null;
  }>,
  payload: AdChangePayload,
): Promise<void> {
  const timeoutMs = stepRunningTimeoutMs();
  const now = new Date();
  for (const step of steps) {
    if (step.status !== "running") continue;
    if (!isStepRunningStale(step.startedAt, now, timeoutMs)) continue;

    const change = payload.changes.find((c) => c.field === step.kind);
    let liveMatches = false;
    try {
      liveMatches = await liveMatchesProposed({
        kind: step.kind,
        payload,
        proposed: change?.proposed ?? null,
      });
    } catch (err) {
      console.warn("[ad_change.recover]", step.id, err);
      liveMatches = false;
    }

    const resolution = resolveStuckStep({ liveMatches });
    if (resolution === "mark_applied") {
      await prisma.adChangeJobStep.update({
        where: { id: step.id },
        data: {
          status: "applied",
          result: {
            recovered: true,
            alreadyAtProposed: true,
            note: "Stuck running; Meta already matches proposed — no re-apply",
          },
          finishedAt: new Date(),
        },
      });
    } else {
      // Yeniden sahiplen: pending → sonraki döngüde tek claim
      await prisma.adChangeJobStep.updateMany({
        where: { id: step.id, status: "running" },
        data: {
          status: "pending",
          startedAt: null,
          error: null,
          result: {
            recovered: true,
            reclaimed: true,
            note: "Stuck running; Meta differs — reclaim for single apply",
          },
        },
      });
    }
  }
}

async function assertStatusNotStale(payload: AdChangePayload): Promise<void> {
  const statusChange = payload.changes.find(
    (c) => c.field === "ad.status" || c.field === "adset.status",
  );
  if (!statusChange?.current) return;
  if (!payload.target.adId) return;
  if (!process.env.META_SYSTEM_USER_TOKEN?.trim()) return;

  const live = await fetchLiveAdSnapshot(payload.target.adId);
  if (
    isAdStatusStale({
      packageCurrent: statusChange.current,
      liveStatus: live.status,
      liveEffectiveStatus: live.effective_status,
    })
  ) {
    throw new Error(
      statusStaleMessage({
        packageCurrent: statusChange.current,
        liveStatus: live.status,
        liveEffectiveStatus: live.effective_status,
      }),
    );
  }
}

async function applyAllowedStep(
  kind: string,
  payload: AdChangePayload,
  opts: { allowLive: boolean },
): Promise<Record<string, unknown> & { dryRun?: boolean; skipped?: boolean }> {
  const change = payload.changes.find((c) => c.field === kind);
  const proposed = change?.proposed;
  const live = { allowLive: opts.allowLive };

  if (kind === "ad.status" && payload.target.adId) {
    const status =
      String(proposed || "").toUpperCase() === "PAUSED" ? "PAUSED" : "ACTIVE";
    const r = await updateAdStatus(payload.target.adId, status, live);
    return { dryRun: r.dryRun, json: r.json };
  }
  if (kind === "adset.status" && payload.target.adsetId) {
    const status =
      String(proposed || "").toUpperCase() === "PAUSED" ? "PAUSED" : "ACTIVE";
    const r = await updateAdsetStatus(payload.target.adsetId, status, live);
    return { dryRun: r.dryRun, json: r.json };
  }
  if (kind === "adset.daily_budget" && payload.target.adsetId) {
    const tryAmount = Number(proposed);
    if (!Number.isFinite(tryAmount) || tryAmount <= 0) {
      return { skipped: true, reason: "invalid budget" };
    }
    const r = await updateAdsetDailyBudget(
      payload.target.adsetId,
      Math.round(tryAmount * 100),
      live,
    );
    return { dryRun: r.dryRun, json: r.json };
  }

  return {
    dryRun: true,
    unimplemented: true,
    kind,
    note: "Kind izinli fakat Graph uygulayıcısı yok.",
  };
}

// Re-export for tests / callers that used old name
export { tierFlagsFromTenant };
