/**
 * Onaylanan AdChangeJob yürütücüsü.
 * (a) claim + idempotency + status stale
 * (b) üç kapı, simulated/skipped, partial, stuck recovery
 * (c) bütçe bayatlığı / sınır / günlük bütçe yok
 *
 * Job/adım status olarak "succeeded" YAZILMAZ (legacy enum değeri kalır).
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
  compareLiveToPackage,
  isStepRunningStale,
  resolveStuckStep,
  stepRunningTimeoutMs,
  StuckStaleError,
} from "@/lib/panel/ads-publish/step-recovery";
import {
  assertLiveBudgetBeforeApply,
  BudgetCheckError,
} from "@/lib/panel/ads-publish/budget-check";
import { packageBudgetToMetaMinor } from "@/lib/panel/ads-publish/budget-units";
import { mapStepStatusForAggregate } from "@/lib/panel/ads-publish/job-status-labels";
import { assertTargetOwnership } from "@/lib/panel/ads-publish/ownership";
import {
  nextAttemptStateAfterFailure,
  readAttemptState,
  shouldDeferAttempt,
} from "@/lib/panel/ads-publish/step-retry";
import { createPanelNotice } from "@/lib/panel/panel-notices";
import { audit } from "@/lib/panel/audit";
import { MetaGraphError } from "@/lib/integrations/meta/graph";

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
  const step = await prisma.adChangeJobStep.findUnique({
    where: { id: stepId },
    select: { id: true, status: true, result: true },
  });
  if (!step || step.status !== "pending") return false;
  if (shouldDeferAttempt(step.result)) return false;
  const result = await prisma.adChangeJobStep.updateMany({
    where: { id: stepId, status: "pending" },
    data: { status: "running", startedAt: new Date() },
  });
  return result.count === 1;
}

/** Zamanlayıcı / kuyruk: queued + takılı running. */
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
    await assertTargetOwnership({
      tenantId: job.package.tenantId,
      payload,
    });
    await assertStatusNotStale(payload);
    await assertLiveBudgetBeforeApply(payload);

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

    await recoverStuckSteps(job.packageId, job.id, steps, payload);

    steps = await prisma.adChangeJobStep.findMany({
      where: { jobId: job.id },
      orderBy: { sortOrder: "asc" },
    });

    for (const step of steps) {
      if (
        step.status === "applied" ||
        step.status === "simulated" ||
        step.status === "skipped" ||
        step.status === "succeeded" // legacy: dokunma, yeniden yazma
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

        const result = await applyAllowedStep(step.kind, payload, {
          allowLive: true,
          tenantId: job.package.tenantId,
          jobId: job.id,
          stepId: step.id,
        });
        if (result.rejected) {
          await prisma.adChangeJobStep.update({
            where: { id: step.id },
            data: {
              status: "failed",
              error: String(result.reason || "rejected"),
              result: result as object,
              finishedAt: new Date(),
            },
          });
          throw new BudgetCheckError(
            String(result.reason || "rejected"),
            (result.code as "no_daily_budget") || "invalid_budget",
          );
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
        const prev = readAttemptState(step.result);
        const retryable =
          err instanceof MetaGraphError || /rate limit|timeout|ECONNRESET/i.test(message);
        if (retryable) {
          const next = nextAttemptStateAfterFailure({
            previous: prev,
            err,
          });
          if (!next.exhausted) {
            await prisma.adChangeJobStep.update({
              where: { id: step.id },
              data: {
                status: "pending",
                startedAt: null,
                error: message,
                result: {
                  ...((step.result as object) ?? {}),
                  attempts: next.state.attempts,
                  nextAttemptAt: next.state.nextAttemptAt,
                  lastError: message,
                  waitMs: next.waitMs,
                },
              },
            });
            continue;
          }
          await prisma.adChangeJobStep.update({
            where: { id: step.id },
            data: {
              status: "failed",
              error: message,
              result: {
                ...((step.result as object) ?? {}),
                attempts: next.state.attempts,
                exhausted: true,
              },
              finishedAt: new Date(),
            },
          });
          await notifyStepRetriesExhausted({
            jobId: job.id,
            packageId: job.packageId,
            packageTitle: job.package.title,
            tenantId: job.package.tenantId,
            tenantSlug: job.package.tenant.slug,
            userId: job.package.createdById,
            kind: step.kind,
            attempts: next.state.attempts,
            message,
          });
          throw err;
        }
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
      select: { status: true, result: true },
    });
    const waitingRetry = finalSteps.some(
      (s) => s.status === "pending" || s.status === "running",
    );
    if (waitingRetry) {
      // Artan bekleme / takılı adım — job running kalsın; zamanlayıcı tekrar dener
      await prisma.adChangeJob.update({
        where: { id: job.id },
        data: { status: "running", finishedAt: null },
      });
      console.info("[ad_change.job]", job.id, "waiting_retry", job.package.title);
      return;
    }

    const mapped = finalSteps.map((s) => mapStepStatusForAggregate(s.status));
    // legacy_succeeded asla applied sayılmaz → partial
    const forAgg = mapped.map((s) =>
      s === "legacy_succeeded" ? ("simulated" as const) : s,
    );
    const outcome = aggregateOutcome(forAgg);

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

    const needsReapprove =
      err instanceof StuckStaleError ||
      (err instanceof BudgetCheckError && err.code === "stale_budget") ||
      /stale|yeniden onaya/i.test(message);
    if (needsReapprove) {
      await prisma.adChangeJob.update({
        where: { id: job.id },
        data: { status: "failed", lastError: message, finishedAt: new Date() },
      });
      await prisma.adChangePackage.update({
        where: { id: job.packageId },
        data: { status: "pending" },
      });
      console.warn("[ad_change.job]", job.id, "re-approve", message);
      return;
    }

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
  packageId: string,
  jobId: string,
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
    let compare = { matchesProposed: false, matchesInitial: false };
    try {
      compare = await compareLiveToPackage({
        kind: step.kind,
        payload,
        proposed: change?.proposed ?? null,
        initial: change?.current ?? null,
      });
    } catch (err) {
      console.warn("[ad_change.recover]", step.id, err);
    }

    const resolution = resolveStuckStep({
      liveMatchesProposed: compare.matchesProposed,
      liveMatchesInitial: compare.matchesInitial,
    });

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
      continue;
    }

    if (resolution === "reclaim_pending") {
      await prisma.adChangeJobStep.updateMany({
        where: { id: step.id, status: "running" },
        data: {
          status: "pending",
          startedAt: null,
          error: null,
          result: {
            recovered: true,
            reclaimed: true,
            note: "Stuck running; Meta still at initial — reclaim for single apply",
          },
        },
      });
      continue;
    }

    // stale_reapprove
    await prisma.adChangeJobStep.update({
      where: { id: step.id },
      data: {
        status: "failed",
        error: "Stale during recovery: Meta matches neither proposed nor initial",
        result: {
          recovered: true,
          stale: true,
          note: "Stuck running; Meta drifted — package returned to approval",
        },
        finishedAt: new Date(),
      },
    });
    throw new StuckStaleError(
      `Takılı adım bayat: Meta ne önerilen ne başlangıç değerde (job=${jobId}, package=${packageId}). Yeniden onaya sunun.`,
    );
  }
}

async function notifyStepRetriesExhausted(opts: {
  jobId: string;
  packageId: string;
  packageTitle: string;
  tenantId: string;
  tenantSlug: string;
  userId: string | null;
  kind: string;
  attempts: number;
  message: string;
}): Promise<void> {
  await audit(
    opts.userId ? { user: { id: opts.userId } } : null,
    {
      action: "ad_change.step_retries_exhausted",
      entity: "ad_change",
      entityId: opts.packageId,
      tenantId: opts.tenantId,
      summary: `${opts.packageTitle}: ${opts.kind} deneme limiti (${opts.attempts}) — ${opts.message}`,
    },
  );
  if (!opts.userId) return;
  try {
    await createPanelNotice({
      userId: opts.userId,
      tenantId: opts.tenantId,
      kind: "ad_change.step_retries_exhausted",
      title: `Meta adım başarısız: ${opts.packageTitle}`,
      body: `${opts.kind} — ${opts.attempts} deneme sonrası: ${opts.message}`,
      href: `/meta-yayin?brand=${encodeURIComponent(opts.tenantSlug)}`,
    });
  } catch (err) {
    console.warn("[ad_change.notice]", err);
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
  opts: {
    allowLive: boolean;
    tenantId?: string;
    jobId?: string;
    stepId?: string;
  },
): Promise<
  Record<string, unknown> & {
    dryRun?: boolean;
    rejected?: boolean;
    reason?: string;
    code?: string;
  }
> {
  const change = payload.changes.find((c) => c.field === kind);
  const proposed = change?.proposed;
  const live = {
    allowLive: opts.allowLive,
    tenantId: opts.tenantId,
    jobId: opts.jobId,
    stepId: opts.stepId,
  };

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
    const proposedMinor = packageBudgetToMetaMinor(proposed);
    if (proposedMinor === null || proposedMinor <= 0) {
      return {
        rejected: true,
        code: "invalid_budget",
        reason: "Geçersiz günlük bütçe değeri.",
      };
    }
    // Günlük bütçe yokluğu assertLiveBudgetBeforeApply’da; burada yaz.
    const r = await updateAdsetDailyBudget(
      payload.target.adsetId,
      proposedMinor,
      live,
    );
    return { dryRun: r.dryRun, json: r.json, minor: proposedMinor };
  }

  return {
    dryRun: true,
    unimplemented: true,
    kind,
    note: "Kind izinli fakat Graph uygulayıcısı yok.",
  };
}

export { tierFlagsFromTenant };
