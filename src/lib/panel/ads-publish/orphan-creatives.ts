import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function recordOrphanCreative(opts: {
  tenantId: string;
  adAccountId: string;
  creativeId: string;
  adId?: string;
  packageId?: string | null;
  jobId?: string | null;
  stepId?: string | null;
  reason: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  if (!opts.creativeId || opts.creativeId.startsWith("dryrun_")) return;
  await prisma.metaOrphanCreative.upsert({
    where: {
      tenantId_creativeId: {
        tenantId: opts.tenantId,
        creativeId: opts.creativeId,
      },
    },
    create: {
      tenantId: opts.tenantId,
      adAccountId: opts.adAccountId,
      creativeId: opts.creativeId,
      adId: opts.adId || "",
      packageId: opts.packageId ?? null,
      jobId: opts.jobId ?? null,
      stepId: opts.stepId ?? null,
      reason: opts.reason,
      detail: (opts.detail ?? {}) as Prisma.InputJsonValue,
    },
    update: {
      reason: opts.reason,
      adId: opts.adId || "",
      packageId: opts.packageId ?? null,
      jobId: opts.jobId ?? null,
      stepId: opts.stepId ?? null,
      detail: (opts.detail ?? {}) as Prisma.InputJsonValue,
      resolvedAt: null,
      updatedAt: new Date(),
    },
  });
}

export async function listOrphanCreatives(opts?: {
  tenantId?: string;
  includeResolved?: boolean;
  take?: number;
}) {
  return prisma.metaOrphanCreative.findMany({
    where: {
      ...(opts?.tenantId ? { tenantId: opts.tenantId } : {}),
      ...(opts?.includeResolved ? {} : { resolvedAt: null }),
    },
    orderBy: { createdAt: "desc" },
    take: opts?.take ?? 100,
    include: {
      tenant: { select: { id: true, slug: true, name: true } },
    },
  });
}

export async function markOrphanResolved(id: string) {
  return prisma.metaOrphanCreative.update({
    where: { id },
    data: { resolvedAt: new Date() },
  });
}

export function formatReviewFeedback(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.slice(0, 500);
  try {
    const s = JSON.stringify(raw);
    return s.length > 500 ? `${s.slice(0, 500)}…` : s;
  } catch {
    return String(raw).slice(0, 500);
  }
}

export function reviewStatusLabel(effective: string): string {
  const e = effective.toUpperCase();
  if (e === "PENDING_REVIEW" || e === "IN_PROCESS") return "İncelemede";
  if (e === "DISAPPROVED" || e === "WITH_ISSUES") return "Reddedildi";
  if (e === "ACTIVE" || e === "PAUSED") return "Onaylandı / hazır";
  if (!e) return "—";
  return e;
}
