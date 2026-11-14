import { prisma } from "@/lib/db";

export type BrandCreativeTask = {
  cardId: string;
  title: string;
  description: string | null;
  columnName: string;
  columnDone: boolean;
  readyForAds: boolean;
  dueAt: string | null;
  images: string[];
  labels: string[];
  assignees: Array<{ id: string; name: string }>;
  contentPostId: string | null;
  contentStatus: string | null;
  contentMediaUrls: string[];
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
};

function isDoneColumn(name: string): boolean {
  return name.toLocaleLowerCase("tr").includes("tamam");
}

function isReviewColumn(name: string): boolean {
  const n = name.toLocaleLowerCase("tr");
  return n.includes("incele") || n.includes("revize");
}

function looksLikeDesignCard(opts: {
  labels: string[];
  teamSlug: string | null;
  title: string;
  hasContentPost: boolean;
}): boolean {
  if (opts.hasContentPost) return true;
  if (opts.teamSlug === "grafik-tasarim") return true;
  const blob = [...opts.labels, opts.title].join(" ").toLocaleLowerCase("tr");
  return /tasar[ıi]m|grafik|kreatif|creative|görsel|video/.test(blob);
}

/**
 * Durum panosu + içerik takviminden markaya bağlı kreatif / tasarım görevleri.
 * readyForAds: kolon tamamlandı/incelemede veya görsel hazır.
 */
export async function listBrandCreativeTasks(opts?: {
  tenantId?: string;
  take?: number;
}): Promise<BrandCreativeTask[]> {
  const take = opts?.take ?? 40;
  const cards = await prisma.boardCard.findMany({
    where: {
      ...(opts?.tenantId ? { tenantId: opts.tenantId } : { tenantId: { not: null } }),
    },
    include: {
      column: { select: { name: true } },
      team: { select: { slug: true } },
      tenant: { select: { id: true, slug: true, name: true } },
      assignees: {
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "asc" },
      },
      contentPost: {
        select: {
          id: true,
          status: true,
          mediaUrls: true,
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: take * 3,
  });

  const out: BrandCreativeTask[] = [];
  for (const card of cards) {
    if (!card.tenant) continue;
    const design = looksLikeDesignCard({
      labels: card.labels,
      teamSlug: card.team?.slug ?? null,
      title: card.title,
      hasContentPost: Boolean(card.contentPost),
    });
    if (!design) continue;

    const columnName = card.column.name;
    const columnDone = isDoneColumn(columnName);
    const images = [
      ...card.images,
      ...(card.contentPost?.mediaUrls ?? []),
    ].filter(Boolean);
    const contentStatus = card.contentPost?.status ?? null;
    const readyForAds =
      columnDone ||
      isReviewColumn(columnName) ||
      contentStatus === "review" ||
      contentStatus === "published" ||
      images.length > 0;

    out.push({
      cardId: card.id,
      title: card.title,
      description: card.description,
      columnName,
      columnDone,
      readyForAds,
      dueAt: card.dueAt?.toISOString() ?? null,
      images,
      labels: card.labels,
      assignees: card.assignees.map((a) => ({
        id: a.user.id,
        name: (a.user.name ?? "").trim() || a.user.email,
      })),
      contentPostId: card.contentPost?.id ?? null,
      contentStatus,
      contentMediaUrls: card.contentPost?.mediaUrls ?? [],
      tenantId: card.tenant.id,
      tenantSlug: card.tenant.slug,
      tenantName: card.tenant.name,
    });
    if (out.length >= take) break;
  }
  return out;
}
