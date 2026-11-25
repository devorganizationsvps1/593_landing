/**
 * Onaylanan AdChangeJob yürütücüsü.
 * (a) claim + idempotency + status stale
 * (b) üç kapı, simulated/skipped, partial, stuck recovery
 * (c) bütçe bayatlığı / sınır / günlük bütçe yok
 *
 * Job/adım status olarak "succeeded" YAZILMAZ (legacy enum değeri kalır).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { AdChangePayload } from "@/lib/panel/ads-publish/types";
import {
  bindAdCreative,
  createAdCreative,
  fetchLiveAdCreative,
  fetchLiveAdSnapshot,
  fetchLiveCreativeById,
  updateAdStatus,
  updateAdsetDailyBudget,
  updateAdsetStatus,
} from "@/lib/integrations/meta/write";
import { stepIdempotencyKey } from "@/lib/panel/ads-publish/write-kinds";
import {
  assertCreateBodyPreservesUnchangedFields,
  assertReadBackMatchesExpected,
  buildAdCreativeCreateBody,
  creativeFingerprint,
  getCreativeEditMeta,
  snapshotFromLiveCreative,
  storedNewCreativeIdFromStepResult,
  UnsupportedCreativeShapeError,
  type CreativeEditMeta,
  type CreativeTextSnapshot,
} from "@/lib/panel/ads-publish/creative-edit";
import {
  formatReviewFeedback,
  recordOrphanCreative,
  reviewStatusLabel,
} from "@/lib/panel/ads-publish/orphan-creatives";
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
    await assertCreativeNotStale(payload);
    await assertLiveBudgetBeforeApply(payload, {
      tenantCurrency: job.package.tenant.currency,
      metaCurrency: job.package.tenant.metaCurrency,
    });

    let steps = job.steps;
    if (steps.length === 0) {
      const kinds = resolveStepKinds(payload);
      const seen = new Set<string>();
      const rows: Array<{
        jobId: string;
        sortOrder: number;
        kind: string;
        idempotencyKey: string;
        dependsOn: string | null;
      }> = [];
      const creativeMeta = getCreativeEditMeta(payload);
      kinds.forEach((kind, i) => {
        const change = payload.changes.find((c) => c.field === kind);
        const proposedForKey =
          kind === "creative.create"
            ? creativeMeta?.currentFingerprint ?? change?.proposed ?? null
            : kind === "creative.bind"
              ? creativeMeta?.restoreCreativeId ||
                creativeMeta?.newCreativeId ||
                creativeMeta?.currentFingerprint ||
                change?.proposed ||
                null
              : (change?.proposed ?? null);
        const key = stepIdempotencyKey({
          versionId: job.versionId,
          kind,
          target: payload.target,
          proposed: proposedForKey,
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

/** Test / iç kullanım — kind → Graph create/bind uygulayıcısı. */
export async function applyAllowedStep(
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

  if (kind === "creative.create") {
    return applyCreativeCreate(payload, live);
  }
  if (kind === "creative.bind") {
    return applyCreativeBind(payload, live);
  }

  return {
    dryRun: true,
    unimplemented: true,
    kind,
    note: "Kind izinli fakat Graph uygulayıcısı yok.",
  };
}

function resolveStepKinds(payload: AdChangePayload): string[] {
  if (payload.plan.length > 0) {
    return payload.plan.map((p) => p.key);
  }
  const creative = getCreativeEditMeta(payload);
  if (creative) {
    if (creative.mode === "revert_bind") return ["creative.bind"];
    return ["creative.create", "creative.bind"];
  }
  // Field-level creative changes without plan → create+bind once
  const hasCreativeFields = payload.changes.some(
    (c) =>
      c.field.startsWith("creative.") &&
      c.field !== "creative.create" &&
      c.field !== "creative.bind" &&
      c.field !== "creative.media",
  );
  if (hasCreativeFields) {
    return ["creative.create", "creative.bind"];
  }
  return payload.changes.map((c) => c.field);
}

async function assertCreativeNotStale(payload: AdChangePayload): Promise<void> {
  const meta = getCreativeEditMeta(payload);
  if (!meta || !payload.target.adId) return;
  if (!process.env.META_SYSTEM_USER_TOKEN?.trim()) return;
  if (meta.mode === "revert_bind") return;

  const { creative } = await fetchLiveAdCreative(payload.target.adId);
  if (creative.id !== meta.currentCreativeId) {
    throw new Error(
      `Kreatif bayat: paket ${meta.currentCreativeId}, canlı ${creative.id}. Yeniden onaya sunun.`,
    );
  }
  const liveSnap = snapshotFromLiveCreative(creative);
  const liveFp = creativeFingerprint(liveSnap);
  if (liveFp !== meta.currentFingerprint) {
    throw new Error(
      "Kreatif içeriği onay önizlemesinden sonra değişmiş. Yeniden onaya sunun.",
    );
  }
}

async function resolveStoredNewCreativeId(
  payload: AdChangePayload,
): Promise<string | null> {
  const meta = getCreativeEditMeta(payload);
  if (meta?.newCreativeId) return meta.newCreativeId;
  if (!payload.target.adId) return null;
  // Job step result — create applied
  return null;
}

async function persistNewCreativeIdOnVersion(
  jobId: string | undefined,
  meta: CreativeEditMeta,
  newCreativeId: string,
  expectedCreateBody?: Record<string, unknown>,
): Promise<void> {
  if (!jobId) return;
  const job = await prisma.adChangeJob.findUnique({
    where: { id: jobId },
    select: { versionId: true },
  });
  if (!job) return;
  const version = await prisma.adChangePackageVersion.findUnique({
    where: { id: job.versionId },
  });
  if (!version) return;
  const nextPayload = {
    ...(version.payload as object),
    creative: {
      ...meta,
      newCreativeId,
      expectedCreateBody: expectedCreateBody ?? meta.expectedCreateBody,
    } satisfies CreativeEditMeta,
  };
  await prisma.adChangePackageVersion.update({
    where: { id: version.id },
    data: { payload: nextPayload as object },
  });
}

async function applyCreativeCreate(
  payload: AdChangePayload,
  live: {
    allowLive: boolean;
    tenantId?: string;
    jobId?: string;
    stepId?: string;
  },
): Promise<Record<string, unknown>> {
  const meta = getCreativeEditMeta(payload);
  if (!meta) {
    return {
      rejected: true,
      reason: "Kreatif meta (payload.creative) eksik.",
    };
  }
  if (meta.mode === "revert_bind") {
    return {
      rejected: true,
      reason: "revert_bind create adımı kullanmaz.",
    };
  }
  if (
    meta.mode !== "spec_patch" &&
    meta.mode !== "url_tags_only"
  ) {
    return {
      rejected: true,
      code: "unsupported_creative_shape",
      reason: `K2a modu desteklenmiyor: ${meta.mode}`,
    };
  }

  if (live.stepId) {
    const step = await prisma.adChangeJobStep.findUnique({
      where: { id: live.stepId },
      select: { result: true },
    });
    const stored = storedNewCreativeIdFromStepResult(step?.result);
    if (stored) {
      return {
        newCreativeId: stored,
        reusedStoredCreativeId: true,
        dryRun: false,
        readBackOk: true,
      };
    }
  }
  if (meta.newCreativeId) {
    return {
      newCreativeId: meta.newCreativeId,
      reusedStoredCreativeId: true,
      dryRun: false,
      readBackOk: true,
    };
  }

  const accountId = payload.target.adAccountId;
  if (!accountId) {
    return { rejected: true, reason: "adAccountId eksik" };
  }

  const current = meta.current as unknown as CreativeTextSnapshot;
  const proposed = meta.proposed as unknown as CreativeTextSnapshot;

  let body: Record<string, unknown>;
  try {
    body = buildAdCreativeCreateBody({
      mode: meta.mode,
      current,
      proposed,
      name: `593 K2a ${payload.target.adId || ""} ${Date.now()}`.slice(0, 100),
    });
    assertCreateBodyPreservesUnchangedFields({
      mode: meta.mode,
      current,
      createBody: body,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      err instanceof UnsupportedCreativeShapeError
        ? "unsupported_creative_shape"
        : "creative_diff_violation";
    return { rejected: true, code, reason: message };
  }

  const r = await createAdCreative(accountId, body, live);
  const newCreativeId =
    (r.json as { id?: string })?.id ||
    (r.dryRun ? `dryrun_creative_${Date.now()}` : "");
  if (!newCreativeId) {
    return { rejected: true, reason: "Meta kreatif id dönmedi" };
  }

  if (live.stepId) {
    await prisma.adChangeJobStep.update({
      where: { id: live.stepId },
      data: {
        result: {
          newCreativeId,
          dryRun: r.dryRun,
          expectedCreateBody: body,
        } as Prisma.InputJsonValue,
      },
    });
  }
  await persistNewCreativeIdOnVersion(live.jobId, meta, newCreativeId, body);

  // Geri okuma — uyuşmazsa bind yok, orphan kaydı
  if (!r.dryRun && process.env.META_SYSTEM_USER_TOKEN?.trim()) {
    try {
      const liveCreated = await fetchLiveCreativeById(newCreativeId);
      assertReadBackMatchesExpected({
        expectedCreateBody: body,
        liveCreative: liveCreated,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (live.tenantId) {
        await recordOrphanCreative({
          tenantId: live.tenantId,
          adAccountId: accountId,
          creativeId: newCreativeId,
          adId: payload.target.adId,
          jobId: live.jobId,
          stepId: live.stepId,
          reason: "readback_mismatch",
          detail: { message, expectedKeys: Object.keys(body) },
        });
      }
      return {
        rejected: true,
        code: "readback_mismatch",
        reason: message,
        newCreativeId,
        orphanRecorded: true,
      };
    }
  }

  return {
    newCreativeId,
    dryRun: r.dryRun,
    json: r.json,
    adIdPreserved: payload.target.adId,
    readBackOk: true,
    expectedCreateBody: body,
  };
}

async function applyCreativeBind(
  payload: AdChangePayload,
  live: {
    allowLive: boolean;
    tenantId?: string;
    jobId?: string;
    stepId?: string;
  },
): Promise<Record<string, unknown>> {
  const meta = getCreativeEditMeta(payload);
  const adId = payload.target.adId;
  if (!adId) {
    return { rejected: true, reason: "adId eksik" };
  }

  let creativeId: string | null =
    meta?.mode === "revert_bind"
      ? meta.restoreCreativeId || null
      : meta?.newCreativeId || null;

  if (!creativeId && live.jobId) {
    const createStep = await prisma.adChangeJobStep.findFirst({
      where: { jobId: live.jobId, kind: "creative.create" },
      select: { result: true, status: true },
    });
    const fromStep = (createStep?.result ?? {}) as {
      newCreativeId?: string;
      readBackOk?: boolean;
      rejected?: boolean;
      code?: string;
    };
    if (fromStep.rejected || fromStep.code === "readback_mismatch") {
      return {
        rejected: true,
        reason: "Create geri okuma başarısız — bind atlandı.",
        code: "readback_mismatch",
      };
    }
    if (fromStep.newCreativeId) creativeId = fromStep.newCreativeId;
  }
  if (!creativeId) {
    creativeId = await resolveStoredNewCreativeId(payload);
  }
  if (!creativeId) {
    return {
      rejected: true,
      reason: "Bağlanacak creative_id yok (create sonucu eksik).",
    };
  }

  const before = await fetchLiveAdSnapshot(adId);
  let r: Awaited<ReturnType<typeof bindAdCreative>>;
  try {
    r = await bindAdCreative(adId, creativeId, live);
  } catch (err) {
    if (live.tenantId && meta?.mode !== "revert_bind") {
      await recordOrphanCreative({
        tenantId: live.tenantId,
        adAccountId: payload.target.adAccountId,
        creativeId,
        adId,
        jobId: live.jobId,
        stepId: live.stepId,
        reason: "bind_failed",
        detail: {
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
    throw err;
  }

  let verified = false;
  let liveCreativeId: string | undefined;
  let effectiveStatus = "";
  let reviewFeedback = "";
  if (!r.dryRun && process.env.META_SYSTEM_USER_TOKEN?.trim()) {
    const after = await fetchLiveAdSnapshot(adId);
    liveCreativeId = after.creative?.id;
    effectiveStatus = after.effective_status || after.status || "";
    reviewFeedback = formatReviewFeedback(after.ad_review_feedback);
    verified =
      after.id === adId &&
      (liveCreativeId === creativeId || liveCreativeId === String(creativeId));
    if (!verified) {
      if (live.tenantId && meta?.mode !== "revert_bind") {
        await recordOrphanCreative({
          tenantId: live.tenantId,
          adAccountId: payload.target.adAccountId,
          creativeId,
          adId,
          jobId: live.jobId,
          stepId: live.stepId,
          reason: "bind_verify_failed",
          detail: { liveCreativeId, expected: creativeId },
        });
      }
      return {
        rejected: true,
        reason: `Bağlama doğrulanamadı: ad=${after.id} creative=${liveCreativeId || "yok"} beklenen=${creativeId}`,
        code: "bind_verify_failed",
        previousCreativeId: before.creative?.id,
        newCreativeId: creativeId,
        orphanRecorded: true,
      };
    }

    if (live.jobId) {
      const job = await prisma.adChangeJob.findUnique({
        where: { id: live.jobId },
        select: { packageId: true, package: { select: { createdById: true, tenant: { select: { slug: true } }, title: true } } },
      });
      if (job) {
        await prisma.adChangePackage.update({
          where: { id: job.packageId },
          data: {
            metaReviewStatus: effectiveStatus,
            metaReviewFeedback: reviewFeedback,
          },
        });
        const disapproved = /DISAPPROVED|WITH_ISSUES/i.test(effectiveStatus);
        if (disapproved && job.package.createdById) {
          await createPanelNotice({
            userId: job.package.createdById,
            tenantId: live.tenantId,
            kind: "ad_change.review_disapproved",
            title: `Reklam reddedildi: ${job.package.title}`,
            body: `${reviewStatusLabel(effectiveStatus)}${reviewFeedback ? ` — ${reviewFeedback}` : ""}`,
            href: `/meta-yayin?brand=${encodeURIComponent(job.package.tenant.slug)}`,
          }).catch(() => undefined);
        }
      }
    }
  } else {
    verified = r.dryRun;
  }

  return {
    dryRun: r.dryRun,
    json: r.json,
    adId,
    adIdPreserved: true,
    previousCreativeId: before.creative?.id || meta?.currentCreativeId || null,
    newCreativeId: creativeId,
    liveCreativeId,
    verified,
    effectiveStatus,
    reviewFeedback,
    reviewLabel: reviewStatusLabel(effectiveStatus),
  };
}

export { tierFlagsFromTenant };
