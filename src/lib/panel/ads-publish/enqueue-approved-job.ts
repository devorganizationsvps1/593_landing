/**
 * Onay sonrası tek job giriş noktası.
 * Edit yolları (create/save/submit) bu modülü import etmemeli.
 */
import { prisma } from "@/lib/db";

export async function enqueueAndRunApprovedJob(opts: {
  packageId: string;
  versionId: string;
}): Promise<{ jobId: string }> {
  const existing = await prisma.adChangeJob.findUnique({
    where: { versionId: opts.versionId },
    select: { id: true },
  });
  if (existing) {
    throw new Error("Bu sürüm için yürütme zaten açılmış");
  }

  const job = await prisma.adChangeJob.create({
    data: {
      packageId: opts.packageId,
      versionId: opts.versionId,
      status: "queued",
    },
  });

  try {
    const { runAdChangeJob } = await import(
      "@/lib/panel/ads-publish/job-runner"
    );
    await runAdChangeJob(job.id);
  } catch (err) {
    console.error("[ad_change.job]", job.id, err);
  }

  return { jobId: job.id };
}
