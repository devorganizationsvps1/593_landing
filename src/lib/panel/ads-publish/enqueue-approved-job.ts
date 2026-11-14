/**
 * Onay sonrası tek job giriş noktası.
 * Edit yolları (create/save/submit) bu modülü import etmemeli.
 *
 * Job düzeyinde benzersizlik: AdChangeJob.versionId @unique.
 * Yarışta ikinci create P2002 alır → mevcut job döner (tek job).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

function isVersionJobUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  );
}

export async function enqueueAndRunApprovedJob(opts: {
  packageId: string;
  versionId: string;
}): Promise<{ jobId: string; created: boolean }> {
  const existing = await prisma.adChangeJob.findUnique({
    where: { versionId: opts.versionId },
    select: { id: true, status: true },
  });
  if (existing) {
    if (existing.status === "queued") {
      await runJobSafe(existing.id);
    }
    return { jobId: existing.id, created: false };
  }

  let jobId: string;
  let created = true;
  try {
    const job = await prisma.adChangeJob.create({
      data: {
        packageId: opts.packageId,
        versionId: opts.versionId,
        status: "queued",
      },
      select: { id: true },
    });
    jobId = job.id;
  } catch (err) {
    if (!isVersionJobUniqueViolation(err)) throw err;
    const raced = await prisma.adChangeJob.findUnique({
      where: { versionId: opts.versionId },
      select: { id: true, status: true },
    });
    if (!raced) throw err;
    created = false;
    jobId = raced.id;
    if (raced.status === "queued") {
      await runJobSafe(jobId);
    }
    return { jobId, created };
  }

  await runJobSafe(jobId);
  return { jobId, created };
}

async function runJobSafe(jobId: string): Promise<void> {
  try {
    const { runAdChangeJob } = await import(
      "@/lib/panel/ads-publish/job-runner"
    );
    await runAdChangeJob(jobId);
  } catch (err) {
    console.error("[ad_change.job]", jobId, err);
  }
}
