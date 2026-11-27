import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/panel/audit";
import { requirePermissionApi, requirePortalViewApi, resolveStaffUserId } from "@/lib/panel/staff-auth";
import { isSocialPlatform } from "@/lib/social/formats";
import { listMetaPages } from "@/lib/social/meta";
import { openToken } from "@/lib/crypto/token-box";
import { oauthProvider } from "@/lib/social/oauth-providers";
import { serializeAccount } from "@/lib/social/state";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

async function tenantBySlug(slug: string) {
  return prisma.tenant.findUnique({ where: { slug }, select: { id: true, name: true } });
}

export async function GET(_request: Request, ctx: Ctx) {
  const { error } = await requirePortalViewApi();
  if (error) return error;
  const tenant = await tenantBySlug((await ctx.params).slug);
  if (!tenant) return NextResponse.json({ error: "Marka bulunamadı" }, { status: 404 });
  const rows = await prisma.socialAccount.findMany({
    where: { tenantId: tenant.id },
    orderBy: { platform: "asc" },
  });
  return NextResponse.json({ accounts: rows.map(serializeAccount) });
}

/**
 * POST { provider: "meta", pageId, instagram?: boolean } — sayfayı (ve bağlı
 * Instagram hesabını) markaya bağlar. Sayfa system user listesinden doğrulanır.
 */
export async function POST(request: Request, ctx: Ctx) {
  const { session, error } = await requirePermissionApi("brands.edit");
  if (error || !session) return error;
  const tenant = await tenantBySlug((await ctx.params).slug);
  if (!tenant) return NextResponse.json({ error: "Marka bulunamadı" }, { status: 404 });

  let body: { provider?: string; pageId?: string; instagram?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON gerekli" }, { status: 400 });
  }
  if (body.provider !== "meta" || !body.pageId) {
    return NextResponse.json({ error: "Desteklenmeyen bağlantı" }, { status: 400 });
  }

  let page;
  try {
    page = (await listMetaPages()).find((p) => p.pageId === body.pageId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Meta sayfaları alınamadı" },
      { status: 502 },
    );
  }
  if (!page) {
    return NextResponse.json({ error: "Sayfa system user'a atanmamış" }, { status: 400 });
  }

  const actorId = await resolveStaffUserId(session);
  const base = { authSource: "meta_system_user", status: "active", lastError: null, connectedById: actorId };
  await prisma.socialAccount.upsert({
    where: { tenantId_platform: { tenantId: tenant.id, platform: "facebook" } },
    create: {
      tenantId: tenant.id,
      platform: "facebook",
      externalId: page.pageId,
      name: page.pageName,
      pictureUrl: page.pagePicture,
      ...base,
    },
    update: { externalId: page.pageId, name: page.pageName, pictureUrl: page.pagePicture, ...base },
  });
  if (page.instagram && body.instagram !== false) {
    const ig = page.instagram;
    const data = {
      externalId: ig.id,
      name: ig.name || ig.username || "Instagram",
      username: ig.username,
      pictureUrl: ig.picture,
      parentExternalId: page.pageId,
      ...base,
    };
    await prisma.socialAccount.upsert({
      where: { tenantId_platform: { tenantId: tenant.id, platform: "instagram" } },
      create: { tenantId: tenant.id, platform: "instagram", ...data },
      update: data,
    });
  }

  await audit(session, {
    action: "social_account.connect",
    entity: "social_account",
    entityId: page.pageId,
    tenantId: tenant.id,
    summary: `${tenant.name}: Meta bağlandı — ${page.pageName}${page.instagram ? ` + @${page.instagram.username ?? page.instagram.id}` : ""}`,
  });
  const rows = await prisma.socialAccount.findMany({ where: { tenantId: tenant.id }, orderBy: { platform: "asc" } });
  return NextResponse.json({ accounts: rows.map(serializeAccount) });
}

/** DELETE ?platform= — bağlantıyı kaldırır (bekleyen hedefler hata verir). */
export async function DELETE(request: Request, ctx: Ctx) {
  const { session, error } = await requirePermissionApi("brands.edit");
  if (error || !session) return error;
  const tenant = await tenantBySlug((await ctx.params).slug);
  if (!tenant) return NextResponse.json({ error: "Marka bulunamadı" }, { status: 404 });
  const platform = new URL(request.url).searchParams.get("platform");
  if (!isSocialPlatform(platform)) {
    return NextResponse.json({ error: "Geçersiz platform" }, { status: 400 });
  }
  const existing = await prisma.socialAccount.findUnique({
    where: { tenantId_platform: { tenantId: tenant.id, platform } },
  });
  // OAuth hesaplarında platformdaki izin de geri alınır (en iyi çaba).
  const provider = existing?.authSource === "oauth" ? oauthProvider(platform) : null;
  const token = provider ? openToken(existing!.refreshTokenEnc) ?? openToken(existing!.accessTokenEnc) : null;
  if (provider?.revoke && token) {
    try {
      await provider.revoke(token);
    } catch (err) {
      console.error("[social-oauth] revoke", err);
    }
  }
  const { count } = await prisma.socialAccount.deleteMany({ where: { tenantId: tenant.id, platform } });
  if (count) {
    await audit(session, {
      action: "social_account.disconnect",
      entity: "social_account",
      tenantId: tenant.id,
      summary: `${tenant.name}: ${platform} bağlantısı kaldırıldı`,
    });
  }
  const rows = await prisma.socialAccount.findMany({ where: { tenantId: tenant.id }, orderBy: { platform: "asc" } });
  return NextResponse.json({ accounts: rows.map(serializeAccount) });
}
