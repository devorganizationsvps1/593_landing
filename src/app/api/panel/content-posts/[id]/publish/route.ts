import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/panel/audit";
import { requirePermissionApi, requirePortalViewApi } from "@/lib/panel/staff-auth";
import {
  isFormatFor,
  isSocialPlatform,
  PRIVACY_OPTIONS,
  type SocialPlatformKey,
} from "@/lib/social/formats";
import { publishPostNow } from "@/lib/social/publisher";
import { loadPublishState } from "@/lib/social/state";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/** GET — içeriğin paylaşım durumu (bağlı hesaplar, medya, hedefler). */
export async function GET(_request: Request, ctx: Ctx) {
  const { error } = await requirePortalViewApi();
  if (error) return error;
  const { id } = await ctx.params;
  const state = await loadPublishState(id);
  if (!state) return NextResponse.json({ error: "İçerik bulunamadı" }, { status: 404 });
  return NextResponse.json({ state });
}

type TargetInput = {
  platform?: string;
  format?: string;
  captionOverride?: string | null;
  title?: string | null;
  privacy?: string | null;
};

/**
 * PUT — otomatik paylaşım ayarları: { autoPublish, targets[] }.
 * Listede olmayan (yayınlanmamış) hedefler silinir; paylaşılmış ya da şu an
 * paylaşılan hedeflere dokunulmaz.
 */
export async function PUT(request: Request, ctx: Ctx) {
  const { session, error } = await requirePermissionApi("brands.edit");
  if (error || !session) return error;
  const { id } = await ctx.params;
  const post = await prisma.contentPost.findUnique({
    where: { id },
    select: { id: true, tenantId: true, title: true, targets: true },
  });
  if (!post) return NextResponse.json({ error: "İçerik bulunamadı" }, { status: 404 });

  let body: { autoPublish?: boolean; targets?: TargetInput[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON gerekli" }, { status: 400 });
  }

  const wanted = new Map<SocialPlatformKey, Required<TargetInput>>();
  for (const t of body.targets ?? []) {
    if (!isSocialPlatform(t.platform)) {
      return NextResponse.json({ error: "Geçersiz platform" }, { status: 400 });
    }
    if (!isFormatFor(t.platform, t.format)) {
      return NextResponse.json({ error: `${t.platform}: geçersiz format` }, { status: 400 });
    }
    const privacyOpts = PRIVACY_OPTIONS[t.platform];
    const privacy =
      privacyOpts && t.privacy && privacyOpts.some((o) => o.value === t.privacy) ? t.privacy : null;
    wanted.set(t.platform, {
      platform: t.platform,
      format: t.format,
      captionOverride: t.captionOverride?.trim() || null,
      title: t.title?.trim().slice(0, 100) || null,
      privacy,
    });
  }

  const accounts = await prisma.socialAccount.findMany({
    where: { tenantId: post.tenantId },
    select: { id: true, platform: true },
  });
  const accountOf = new Map(accounts.map((a) => [a.platform as SocialPlatformKey, a.id]));
  for (const p of wanted.keys()) {
    if (!accountOf.has(p)) {
      return NextResponse.json({ error: `${p}: bu markaya bağlı hesap yok` }, { status: 400 });
    }
  }

  const locked = new Set(
    post.targets.filter((t) => t.status === "published" || t.status === "publishing").map((t) => t.platform),
  );

  await prisma.$transaction(async (tx) => {
    await tx.contentPostTarget.deleteMany({
      where: {
        postId: id,
        status: { in: ["pending", "failed"] },
        platform: { notIn: [...wanted.keys()] },
      },
    });
    for (const [platform, t] of wanted) {
      if (locked.has(platform)) continue;
      const data = {
        format: t.format,
        captionOverride: t.captionOverride,
        title: t.title,
        privacy: t.privacy,
        socialAccountId: accountOf.get(platform)!,
      };
      await tx.contentPostTarget.upsert({
        where: { postId_platform: { postId: id, platform } },
        create: { postId: id, platform, ...data },
        // Ayar değişince başarısız hedef yeniden sıraya girer.
        update: { ...data, status: "pending", attempts: 0, nextAttemptAt: null, lastError: null, progressRef: null },
      });
    }
    if (typeof body.autoPublish === "boolean") {
      await tx.contentPost.update({ where: { id }, data: { autoPublish: body.autoPublish } });
    }
  });

  await audit(session, {
    action: "content_post.publish_settings",
    entity: "content_post",
    entityId: id,
    tenantId: post.tenantId,
    summary: `Paylaşım ayarları: ${post.title || id} → ${[...wanted.keys()].join(", ") || "yok"}${
      body.autoPublish ? " (otomatik)" : ""
    }`,
  });
  return NextResponse.json({ state: await loadPublishState(id) });
}

/** POST — { action: "now" | "retry", platforms? } hemen paylaşır. */
export async function POST(request: Request, ctx: Ctx) {
  const { session, error } = await requirePermissionApi("brands.edit");
  if (error || !session) return error;
  const { id } = await ctx.params;
  const post = await prisma.contentPost.findUnique({
    where: { id },
    select: { id: true, tenantId: true, title: true },
  });
  if (!post) return NextResponse.json({ error: "İçerik bulunamadı" }, { status: 404 });

  let body: { action?: string; platforms?: string[] } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const platforms = (body.platforms ?? []).filter(isSocialPlatform);
  const pendingCount = await prisma.contentPostTarget.count({
    where: {
      postId: id,
      status: { in: ["pending", "failed"] },
      ...(platforms.length ? { platform: { in: platforms } } : {}),
    },
  });
  if (pendingCount === 0) {
    return NextResponse.json({ error: "Paylaşılacak hedef yok" }, { status: 400 });
  }

  await audit(session, {
    action: body.action === "retry" ? "content_post.publish_retry" : "content_post.publish_now",
    entity: "content_post",
    entityId: id,
    tenantId: post.tenantId,
    summary: `${body.action === "retry" ? "Tekrar deneniyor" : "Şimdi paylaşılıyor"}: ${post.title || id}`,
  });
  // Video işleme dakikalar sürebilir — yanıt beklemez, istemci durumu yoklar.
  after(async () => {
    try {
      await publishPostNow(id, platforms.length ? platforms : undefined);
    } catch (err) {
      console.error("[social-publish now]", err);
    }
  });
  return NextResponse.json({ ok: true, queued: pendingCount });
}
