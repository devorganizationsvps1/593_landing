import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/panel/audit";
import { requirePermissionApi } from "@/lib/panel/staff-auth";
import { defaultFormat, isSocialPlatform, PUBLISHER_READY, type SocialPlatformKey } from "@/lib/social/formats";

export const runtime = "nodejs";

/**
 * Takvimde zaten olan içerikleri otomatik paylaşıma bağlama.
 * Aday: zamanı gelmemiş, paylaşılmamış, hiç hedefi olmayan ve markasında
 * seçili platformun hesabı bağlı içerik. Bağlanan içerik yine de
 * "Onaylandı" olmadan paylaşılmaz.
 */
async function candidates(ids?: string[]) {
  const posts = await prisma.contentPost.findMany({
    where: {
      ...(ids ? { id: { in: ids } } : {}),
      scheduledAt: { gt: new Date() },
      status: { not: "published" },
      targets: { none: {} },
      tenant: { socialAccounts: { some: {} } },
    },
    select: {
      id: true,
      title: true,
      caption: true,
      platform: true,
      platforms: true,
      scheduledAt: true,
      status: true,
      autoPublish: true,
      tenant: {
        select: { id: true, name: true, socialAccounts: { select: { id: true, platform: true } } },
      },
      media: { select: { kind: true, width: true, height: true, durationSec: true } },
    },
    orderBy: { scheduledAt: "asc" },
    take: 500,
  });
  return posts
    .map((p) => {
      const planned = p.platforms.length ? p.platforms : [p.platform];
      const accountOf = new Map(p.tenant.socialAccounts.map((a) => [a.platform as SocialPlatformKey, a.id]));
      const linkable = planned.filter(
        (x): x is SocialPlatformKey => isSocialPlatform(x) && PUBLISHER_READY[x] && accountOf.has(x),
      );
      return { post: p, linkable, accountOf };
    })
    .filter((c) => c.linkable.length > 0);
}

/** GET — bağlanabilecek içerikler. */
export async function GET() {
  const { error } = await requirePermissionApi("brands.edit");
  if (error) return error;
  const list = await candidates();
  return NextResponse.json({
    posts: list.map(({ post: p, linkable }) => ({
      id: p.id,
      title: p.title || p.caption.replace(/\s+/g, " ").slice(0, 80),
      tenantName: p.tenant.name,
      scheduledAt: p.scheduledAt.toISOString(),
      status: p.status,
      platforms: linkable,
      mediaCount: p.media.length,
    })),
  });
}

/** POST { postIds: string[], autoPublish: boolean } — seçilenlere hedef oluşturur. */
export async function POST(request: Request) {
  const { session, error } = await requirePermissionApi("brands.edit");
  if (error || !session) return error;
  let body: { postIds?: unknown; autoPublish?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON gerekli" }, { status: 400 });
  }
  const ids = Array.isArray(body.postIds) ? body.postIds.filter((x): x is string => typeof x === "string").slice(0, 500) : [];
  if (!ids.length) return NextResponse.json({ error: "İçerik seçin" }, { status: 400 });
  const autoPublish = body.autoPublish === true;

  const list = await candidates(ids);
  let linked = 0;
  for (const { post: p, linkable, accountOf } of list) {
    await prisma.$transaction(async (tx) => {
      // Arada başka biri bağladıysa dokunulmaz.
      if ((await tx.contentPostTarget.count({ where: { postId: p.id } })) > 0) return;
      for (const platform of linkable) {
        await tx.contentPostTarget.create({
          data: {
            postId: p.id,
            platform,
            format: defaultFormat(platform, p.media),
            socialAccountId: accountOf.get(platform)!,
          },
        });
      }
      if (autoPublish && !p.autoPublish) {
        await tx.contentPost.update({ where: { id: p.id }, data: { autoPublish: true } });
      }
      linked++;
    });
  }

  await audit(session, {
    action: "content_post.link_publish",
    entity: "content_post",
    summary: `${linked} içerik otomatik paylaşıma bağlandı${autoPublish ? " (otomatik açık)" : ""}`,
  });
  return NextResponse.json({ linked, skipped: ids.length - linked });
}
