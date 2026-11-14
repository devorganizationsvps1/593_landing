/**
 * Onaylanan AdChangeJob yürütücüsü.
 * (a) Claim-once + adım idempotencyKey + status stale.
 * İzin listesinde olmayan kind → skipped (eski deferred yok).
 */
import { prisma } from "@/lib/db";
import type { AdChangePayload } from "@/lib/panel/ads-publish/types";
import {
  fetchLiveAdSnapshot,
  metaAdsWriteEnabled,
  updateAdStatus,
  updateAdsetDailyBudget,
  updateAdsetStatus,
} from "@/lib/integrations/meta/write";
import {
  isWriteKindAllowed,
  stepIdempotencyKey,
  type WriteTierFlags,
} from "@/lib/panel/ads-publish/write-kinds";
import {
  isAdStatusStale,
  statusStaleMessage,
} from "@/lib/panel/ads-publish/stale-check";

function asPayload(raw: unknown): AdChangePayload {
  return (raw ?? {}) as AdChangePayload;
}

/** Tenant kademe bayrakları — kolonlar (b) ile gelecek; şimdilik hep kapalı. */
export function tierFlagsFromTenant(_tenant: {
  metaAdsWriteEnabled?: boolean;
}): WriteTierFlags {
  return { k1: false, k2: false, k3: false, k4: false };
}

/**
 * queued → running atomik claim.
 * İkinci eşzamanlı çağrı 0 satır günceller → false.
 */
export async function claimAdChangeJob(jobId: string): Promise<boolean> {
  const result = await prisma.adChangeJob.updateMany({
    where: { id: jobId, status: "queued" },
    data: { status: "running", startedAt: new Date(), lastError: null },
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
  return n;
}

export async function runAdChangeJob(jobId: string): Promise<void> {
  const claimed = await claimAdChangeJob(jobId);
  if (!claimed) return;

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
  const tierFlags = tierFlagsFromTenant(job.package.tenant);

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
        const key = stepIdempotencyKey(kind, payload.target);
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

    for (const step of steps) {
      if (step.status === "succeeded" || step.status === "skipped") continue;

      await prisma.adChangeJobStep.update({
        where: { id: step.id },
        data: { status: "running", startedAt: new Date() },
      });

      try {
        if (!isWriteKindAllowed(step.kind, tierFlags)) {
          await prisma.adChangeJobStep.update({
            where: { id: step.id },
            data: {
              status: "skipped",
              result: {
                skipped: true,
                reason: "kind_not_in_allowlist",
                kind: step.kind,
              },
              finishedAt: new Date(),
            },
          });
          continue;
        }

        const result = await applyAllowedStep(step.kind, payload);
        await prisma.adChangeJobStep.update({
          where: { id: step.id },
          data: {
            status: "succeeded",
            result: result as object,
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

    // (b) dry_run_succeeded/applied sonra; şimdilik succeeded/applied.
    // İzin listesi boşken tüm adımlar skipped → yine de job biter.
    await prisma.adChangeJob.update({
      where: { id: job.id },
      data: { status: "succeeded", finishedAt: new Date() },
    });
    await prisma.adChangePackage.update({
      where: { id: job.packageId },
      data: { status: "applied" },
    });

    console.info(
      "[ad_change.job]",
      job.id,
      metaAdsWriteEnabled() ? "finished" : "finished (META_ADS_WRITE off)",
      job.package.title,
    );
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

async function assertStatusNotStale(payload: AdChangePayload): Promise<void> {
  const statusChange = payload.changes.find(
    (c) => c.field === "ad.status" || c.field === "adset.status",
  );
  if (!statusChange?.current) return;
  if (!payload.target.adId && !payload.target.adsetId) return;

  // Canlı okuma: token yoksa / testte atlanır değil — stale için ad snapshot.
  // Graph çağrısı yalnızca adId varken; testler bu fonksiyonu mock’lar.
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
): Promise<Record<string, unknown>> {
  const change = payload.changes.find((c) => c.field === kind);
  const proposed = change?.proposed;

  if (kind === "ad.status" && payload.target.adId) {
    const status =
      String(proposed || "").toUpperCase() === "PAUSED" ? "PAUSED" : "ACTIVE";
    const r = await updateAdStatus(payload.target.adId, status);
    return { dryRun: r.dryRun, json: r.json };
  }
  if (kind === "adset.status" && payload.target.adsetId) {
    const status =
      String(proposed || "").toUpperCase() === "PAUSED" ? "PAUSED" : "ACTIVE";
    const r = await updateAdsetStatus(payload.target.adsetId, status);
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
    );
    return { dryRun: r.dryRun, json: r.json };
  }

  // İzin listesinde ama henüz Graph implementasyonu yok
  return {
    dryRun: true,
    unimplemented: true,
    kind,
    note: "Kind izinli fakat Graph uygulayıcısı yok.",
  };
}
