/**
 * Marka (müşteri) panelindeki paylaşım takvimi — salt okunur.
 * Ajans içi alanlar (brief, sorumlu, tasarımcı, pano kartı, hata mesajları)
 * buradan ASLA dönmez; yalnızca müşterinin göreceği alanlar serileştirilir.
 */
import type { ContentPostStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { previewUrl } from "@/lib/social/media";

const TZ = "Europe/Istanbul";

export type ClientCalendarPost = {
  id: string;
  title: string;
  platform: string;
  /** İstanbul saatine göre YYYY-MM-DD — sunucu/istemci saat dilimi farkından bağımsız. */
  day: string;
  /** İstanbul saatine göre SS:dd */
  time: string;
  status: ContentPostStatus;
  caption: string;
  /** Yüklenen görsel / videolar. */
  media: { id: string; kind: "image" | "video"; url: string }[];
  /** Harici görsel / video bağlantıları. */
  mediaUrls: string[];
  /** Yayınlanan paylaşımların canlı bağlantıları. */
  links: { platform: string; url: string }[];
};

const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFmt = new Intl.DateTimeFormat("tr-TR", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function istanbulDayKey(d: Date): string {
  return dayFmt.format(d);
}

/** Markanın en az bir takvim içeriği var mı → menüde "Paylaşım takvimi" görünür. */
export async function tenantHasCalendar(tenantId: string): Promise<boolean> {
  const row = await prisma.contentPost.findFirst({
    where: { tenantId },
    select: { id: true },
  });
  return Boolean(row);
}

export async function listClientCalendarPosts(opts: {
  tenantId: string;
  from: Date;
  to: Date;
}): Promise<ClientCalendarPost[]> {
  const rows = await prisma.contentPost.findMany({
    where: { tenantId: opts.tenantId, scheduledAt: { gte: opts.from, lte: opts.to } },
    select: {
      id: true,
      title: true,
      platform: true,
      scheduledAt: true,
      status: true,
      caption: true,
      mediaUrls: true,
      media: {
        select: { id: true, kind: true },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      },
      targets: {
        where: { status: "published", permalink: { not: null } },
        select: { platform: true, permalink: true },
        orderBy: { platform: "asc" },
      },
    },
    orderBy: { scheduledAt: "asc" },
    take: 500,
  });
  return rows.map((p) => ({
    id: p.id,
    title: p.title,
    platform: p.platform,
    day: istanbulDayKey(p.scheduledAt),
    time: timeFmt.format(p.scheduledAt),
    status: p.status,
    caption: p.caption,
    media: p.media.map((m) => ({
      id: m.id,
      kind: m.kind === "video" ? ("video" as const) : ("image" as const),
      url: previewUrl(p.id, m.id),
    })),
    mediaUrls: p.mediaUrls,
    links: p.targets.flatMap((t) =>
      t.permalink ? [{ platform: t.platform, url: t.permalink }] : [],
    ),
  }));
}
