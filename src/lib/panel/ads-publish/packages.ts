import type { AdChangePackageStatus, AdChangePlatform, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/panel/audit";
import type { AdsPublishActor } from "@/lib/panel/ads-publish/access";
import type {
  AdChangePackageListItem,
  AdChangePayload,
} from "@/lib/panel/ads-publish/types";
import { assertPayloadBudgetLimits } from "@/lib/panel/ads-publish/budget-check";
import { isStepRunningStale } from "@/lib/panel/ads-publish/step-recovery";
import { assertTargetOwnership } from "@/lib/panel/ads-publish/ownership";
import {
  assertCanApprovePackage,
  assertCanEditTenant,
} from "@/lib/panel/ads-publish/authz";

function outcomeNoteFromJobs(
  jobs?: Array<{
    status: string;
    steps: Array<{
      status: string;
      startedAt: Date | null;
      result: unknown;
    }>;
  }>,
): string | null {
  const latest = jobs?.[0];
  if (!latest) return null;
  const labels: string[] = [];
  for (const step of latest.steps) {
    const r = (step.result ?? {}) as { reasonLabel?: string };
    if (r.reasonLabel) labels.push(r.reasonLabel);
  }
  if (!labels.length) return null;
  return [...new Set(labels)].join(" · ");
}

function isJobStuck(
  jobs?: Array<{
    status: string;
    steps: Array<{ status: string; startedAt: Date | null }>;
  }>,
): boolean {
  const latest = jobs?.[0];
  if (!latest) return false;
  if (latest.status !== "running" && latest.status !== "queued") return false;
  return latest.steps.some(
    (s) => s.status === "running" && isStepRunningStale(s.startedAt),
  );
}

function serializeListItem(row: {
  id: string;
  title: string;
  platform: AdChangePlatform;
  source: AdChangePackageListItem["source"];
  status: AdChangePackageStatus;
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
  tenant: { id: string; name: string; slug: string };
  createdBy: { name: string | null; email: string } | null;
  jobs?: Array<{
    status: string;
    steps: Array<{
      status: string;
      startedAt: Date | null;
      result: unknown;
    }>;
  }>;
}): AdChangePackageListItem {
  const stuck = isJobStuck(row.jobs);
  return {
    id: row.id,
    title: row.title || "Başlıksız paket",
    platform: row.platform,
    source: row.source,
    status: row.status,
    currentVersion: row.currentVersion,
    tenantId: row.tenant.id,
    tenantName: row.tenant.name,
    tenantSlug: row.tenant.slug,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdByName: row.createdBy
      ? (row.createdBy.name ?? "").trim() || row.createdBy.email
      : null,
    outcomeNote: stuck
      ? "Takıldı — kurtarma taraması bekleniyor"
      : outcomeNoteFromJobs(row.jobs),
    isStuck: stuck,
  };
}

export async function listAdChangePackages(opts?: {
  platform?: AdChangePlatform;
  status?: AdChangePackageStatus;
}): Promise<AdChangePackageListItem[]> {
  const rows = await prisma.adChangePackage.findMany({
    where: {
      ...(opts?.platform ? { platform: opts.platform } : {}),
      ...(opts?.status ? { status: opts.status } : {}),
    },
    include: {
      tenant: { select: { id: true, name: true, slug: true } },
      createdBy: { select: { name: true, email: true } },
      jobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          status: true,
          steps: {
            orderBy: { sortOrder: "asc" },
            select: { result: true, status: true, startedAt: true },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return rows.map(serializeListItem);
}

export async function createDraftPackage(opts: {
  actor: AdsPublishActor;
  tenantId: string;
  platform: AdChangePlatform;
  title: string;
  payload: AdChangePayload;
}): Promise<AdChangePackageListItem> {
  const tenant = await prisma.tenant.findFirst({
    where: { id: opts.tenantId },
    select: {
      id: true,
      name: true,
      slug: true,
      metaAccountId: true,
      currency: true,
      metaCurrency: true,
    },
  });
  if (!tenant) throw new Error("Marka bulunamadı");
  await assertCanEditTenant(opts.actor, tenant.id);
  if (!opts.payload.target.adAccountId?.trim()) {
    opts.payload.target.adAccountId = tenant.metaAccountId;
  }
  assertPayloadBudgetLimits(opts.payload, {
    tenantCurrency: tenant.currency,
    metaCurrency: tenant.metaCurrency,
  });
  await assertTargetOwnership({ tenantId: tenant.id, payload: opts.payload });

  const created = await prisma.adChangePackage.create({
    data: {
      tenantId: tenant.id,
      platform: opts.platform,
      source: "manual",
      status: "draft",
      title: opts.title.trim() || `${tenant.name} taslağı`,
      currentVersion: 1,
      createdById: opts.actor.id,
      versions: {
        create: {
          version: 1,
          payload: opts.payload as Prisma.InputJsonValue,
          createdById: opts.actor.id,
        },
      },
    },
    include: {
      tenant: { select: { id: true, name: true, slug: true } },
      createdBy: { select: { name: true, email: true } },
    },
  });

  await audit(
    { user: { id: opts.actor.id, email: opts.actor.email } },
    {
      action: "ad_change.create",
      entity: "ad_change",
      entityId: created.id,
      tenantId: tenant.id,
      summary: `${tenant.name}: ${created.title}`,
    },
  );

  return serializeListItem(created);
}

export async function updateDraftPackage(opts: {
  actor: AdsPublishActor;
  packageId: string;
  title?: string;
  payload: AdChangePayload;
}): Promise<AdChangePackageListItem> {
  const pack = await prisma.adChangePackage.findFirst({
    where: { id: opts.packageId },
    include: {
      tenant: {
        select: {
          id: true,
          name: true,
          slug: true,
          currency: true,
          metaCurrency: true,
        },
      },
    },
  });
  if (!pack) throw new Error("Paket bulunamadı");
  const editable = ["draft", "rejected", "pending", "approved"] as const;
  if (!editable.includes(pack.status as (typeof editable)[number])) {
    throw new Error(
      "Uygulama/sonuç durumundaki paket düzenlenemez; yeni paket açın",
    );
  }
  await assertCanEditTenant(opts.actor, pack.tenantId);
  assertPayloadBudgetLimits(opts.payload, {
    tenantCurrency: pack.tenant.currency,
    metaCurrency: pack.tenant.metaCurrency,
  });
  await assertTargetOwnership({
    tenantId: pack.tenantId,
    payload: opts.payload,
  });

  const nextVersion = pack.currentVersion + 1;
  await prisma.adChangePackageVersion.create({
    data: {
      packageId: pack.id,
      version: nextVersion,
      payload: opts.payload as Prisma.InputJsonValue,
      createdById: opts.actor.id,
    },
  });

  // Onaydan / onaya gönderildikten sonra düzenleme → onay geçersiz, yeniden onay
  const nextStatus =
    pack.status === "pending" || pack.status === "approved"
      ? "draft"
      : pack.status === "rejected"
        ? "draft"
        : "draft";

  const saved = await prisma.adChangePackage.update({
    where: { id: pack.id },
    data: {
      currentVersion: nextVersion,
      status: nextStatus,
      ...(opts.title !== undefined
        ? { title: opts.title.trim() || pack.title }
        : {}),
    },
    include: {
      tenant: { select: { id: true, name: true, slug: true } },
      createdBy: { select: { name: true, email: true } },
    },
  });

  await audit(
    { user: { id: opts.actor.id, email: opts.actor.email } },
    {
      action: "ad_change.update",
      entity: "ad_change",
      entityId: pack.id,
      tenantId: pack.tenantId,
      summary: `${pack.tenant.name}: v${nextVersion} güncellendi`,
    },
  );

  return serializeListItem(saved);
}

export async function getPackageDetail(packageId: string) {
  const pack = await prisma.adChangePackage.findFirst({
    where: { id: packageId },
    include: {
      tenant: {
        select: { id: true, name: true, slug: true, metaAccountId: true },
      },
      createdBy: { select: { name: true, email: true } },
    },
  });
  if (!pack) return null;
  const version = await prisma.adChangePackageVersion.findFirst({
    where: { packageId: pack.id, version: pack.currentVersion },
  });
  return {
    package: serializeListItem(pack),
    payload: (version?.payload ?? {}) as AdChangePayload,
    metaAccountId: pack.tenant.metaAccountId,
  };
}

export async function submitForApproval(opts: {
  actor: AdsPublishActor;
  packageId: string;
}): Promise<AdChangePackageListItem> {
  const pack = await prisma.adChangePackage.findFirst({
    where: { id: opts.packageId },
    include: {
      tenant: { select: { id: true, name: true, slug: true } },
      createdBy: { select: { name: true, email: true } },
    },
  });
  if (!pack) throw new Error("Paket bulunamadı");
  await assertCanEditTenant(opts.actor, pack.tenantId);
  if (pack.status !== "draft" && pack.status !== "rejected") {
    throw new Error("Yalnızca taslak veya reddedilen paket onaya gönderilir");
  }

  const updated = await prisma.adChangePackage.update({
    where: { id: pack.id },
    data: { status: "pending" },
    include: {
      tenant: { select: { id: true, name: true, slug: true } },
      createdBy: { select: { name: true, email: true } },
    },
  });

  await audit(
    { user: { id: opts.actor.id, email: opts.actor.email } },
    {
      action: "ad_change.submit",
      entity: "ad_change",
      entityId: pack.id,
      tenantId: pack.tenantId,
      summary: `${pack.tenant.name}: onaya gönderildi (v${pack.currentVersion})`,
    },
  );

  return serializeListItem(updated);
}

export async function decidePackage(opts: {
  actor: AdsPublishActor;
  packageId: string;
  decision: "approve" | "reject";
  note?: string;
  /** Approve için zorunlu — buildApprovalPreview fingerprint. */
  previewFingerprint?: string;
}): Promise<AdChangePackageListItem> {
  const pack = await prisma.adChangePackage.findFirst({
    where: { id: opts.packageId },
    include: {
      tenant: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!pack) throw new Error("Paket bulunamadı");
  if (pack.status !== "pending") {
    throw new Error("Yalnızca onay bekleyen paket karara bağlanır");
  }
  if (opts.decision === "approve") {
    await assertCanApprovePackage({
      actor: opts.actor,
      packageId: pack.id,
    });
  }

  const version = await prisma.adChangePackageVersion.findFirst({
    where: { packageId: pack.id, version: pack.currentVersion },
    select: { id: true },
  });
  if (!version) throw new Error("Paket sürümü bulunamadı");

  let previewJson: Prisma.InputJsonValue | undefined;
  if (opts.decision === "approve") {
    const { buildApprovalPreview, previewSummaryForStorage } = await import(
      "@/lib/panel/ads-publish/approval-preview"
    );
    const preview = await buildApprovalPreview(pack.id);
    if (!preview) {
      throw new Error("Önizleme üretilemedi; paket onaylanamaz");
    }
    if (!preview.liveReadOk) {
      const when = preview.lastSyncedAt
        ? new Date(preview.lastSyncedAt).toLocaleString("tr-TR")
        : "bilinmiyor";
      throw new Error(
        `Canlı değer okunamadı, son senkronizasyon: ${when}. Onay engellendi.`,
      );
    }
    if (!opts.previewFingerprint?.trim()) {
      throw new Error("Önizleme olmadan onaylanamaz");
    }
    if (opts.previewFingerprint.trim() !== preview.fingerprint) {
      throw new Error(
        "Önizleme bayat veya uyuşmuyor — yeniden önizleyip onaylayın",
      );
    }
    previewJson = previewSummaryForStorage(
      preview,
    ) as unknown as Prisma.InputJsonValue;
  }

  const nextStatus = opts.decision === "approve" ? "approved" : "rejected";

  await prisma.adChangeApproval.create({
    data: {
      packageId: pack.id,
      versionId: version.id,
      actorId: opts.actor.id,
      actorEmail: opts.actor.email,
      decision: opts.decision,
      note: (opts.note ?? "").trim(),
      ...(previewJson !== undefined ? { previewJson } : {}),
    },
  });

  // Önce status; job runner applied/failed/dry_run'a taşıyabilir.
  await prisma.adChangePackage.update({
    where: { id: pack.id },
    data: { status: nextStatus },
  });

  // Job yalnızca approve ile — create/save/submit buraya gelmez.
  if (opts.decision === "approve") {
    const { enqueueAndRunApprovedJob } = await import(
      "@/lib/panel/ads-publish/enqueue-approved-job"
    );
    await enqueueAndRunApprovedJob({
      packageId: pack.id,
      versionId: version.id,
    });
  }

  await audit(
    { user: { id: opts.actor.id, email: opts.actor.email } },
    {
      action:
        opts.decision === "approve" ? "ad_change.approve" : "ad_change.reject",
      entity: "ad_change",
      entityId: pack.id,
      tenantId: pack.tenantId,
      summary: `${pack.tenant.name}: ${opts.decision === "approve" ? "onaylandı" : "reddedildi"} (v${pack.currentVersion})`,
    },
  );

  const latest = await prisma.adChangePackage.findUniqueOrThrow({
    where: { id: pack.id },
    include: {
      tenant: { select: { id: true, name: true, slug: true } },
      createdBy: { select: { name: true, email: true } },
    },
  });
  return serializeListItem(latest);
}
