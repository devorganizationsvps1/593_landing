/**
 * Yazma kapalıyken applied/succeeded kaydedilmiş eski job/paket sayısı.
 * Otomatik düzeltmez — yalnızca raporlar.
 *
 * Usage: npx tsx scripts/report-legacy-dryrun-applied.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "?";
    }
  })();
  console.log(`DB host=${host}`);

  const legacyJobs = await prisma.adChangeJob.findMany({
    where: {
      OR: [
        { status: "succeeded" },
        {
          status: { in: ["applied", "succeeded"] },
          steps: {
            some: {
              OR: [
                { status: "succeeded" },
                {
                  result: {
                    path: ["dryRun"],
                    equals: true,
                  },
                },
              ],
            },
          },
        },
      ],
    },
    select: {
      id: true,
      status: true,
      packageId: true,
      createdAt: true,
      steps: { select: { id: true, status: true, result: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const suspicious = legacyJobs.filter((j) => {
    if (j.status === "succeeded") return true;
    return j.steps.some((s) => {
      if (s.status === "succeeded") return true;
      const r = (s.result ?? {}) as { dryRun?: boolean; simulated?: boolean };
      return r.dryRun === true || r.simulated === true;
    });
  });

  const packageIds = [...new Set(suspicious.map((j) => j.packageId))];
  const packages = packageIds.length
    ? await prisma.adChangePackage.findMany({
        where: {
          id: { in: packageIds },
          status: { in: ["applied", "approved"] },
        },
        select: { id: true, title: true, status: true },
      })
    : [];

  console.log(
    JSON.stringify(
      {
        suspiciousJobCount: suspicious.length,
        packagesStillMarkedAppliedOrApproved: packages.length,
        sampleJobs: suspicious.slice(0, 20).map((j) => ({
          jobId: j.id,
          status: j.status,
          packageId: j.packageId,
          stepStatuses: j.steps.map((s) => s.status),
          dryRunSteps: j.steps.filter((s) => {
            const r = (s.result ?? {}) as { dryRun?: boolean };
            return r.dryRun === true;
          }).length,
        })),
        samplePackages: packages.slice(0, 20),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
