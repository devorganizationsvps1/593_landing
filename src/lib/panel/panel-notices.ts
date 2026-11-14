import { prisma } from "@/lib/db";

export async function createPanelNotice(opts: {
  userId: string;
  tenantId?: string | null;
  kind: string;
  title: string;
  body?: string;
  href?: string | null;
}) {
  return prisma.panelNotice.create({
    data: {
      userId: opts.userId,
      tenantId: opts.tenantId ?? null,
      kind: opts.kind,
      title: opts.title,
      body: opts.body ?? "",
      href: opts.href ?? null,
    },
  });
}

export async function listPanelNotices(userId: string, take = 30) {
  return prisma.panelNotice.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
    include: { tenant: { select: { slug: true, name: true } } },
  });
}

export async function markNoticeRead(id: string, userId: string) {
  return prisma.panelNotice.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  });
}
