import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/panel/audit";
import { requirePermissionApi, resolveStaffUserId } from "@/lib/panel/staff-auth";
import { SOCIAL_PLATFORM_LABEL } from "@/lib/social/formats";
import {
  decodeState,
  OAUTH_NONCE_COOKIE,
  oauthBaseUrl,
  oauthRedirectUri,
  saveOAuthAccount,
} from "@/lib/social/oauth";
import { oauthProvider } from "@/lib/social/oauth-providers";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ platform: string }> };

/** Platform izin ekranından dönüş: kodu token'a çevirir, hesabı markaya bağlar. */
export async function GET(request: NextRequest, ctx: Ctx) {
  const { platform } = await ctx.params;
  const params = request.nextUrl.searchParams;
  const state = decodeState(params.get("state"), request.cookies.get(OAUTH_NONCE_COOKIE)?.value);

  const finish = (opts: { ok?: string; error?: string }) => {
    const path = state ? `/brands/${encodeURIComponent(state.t)}` : "/paylasimlar";
    const url = new URL(path, oauthBaseUrl(request));
    if (opts.ok) url.searchParams.set("social", opts.ok);
    if (opts.error) url.searchParams.set("social_error", opts.error);
    url.hash = "sosyal-hesaplar";
    const res = NextResponse.redirect(url);
    res.cookies.set(OAUTH_NONCE_COOKIE, "", { path: "/api/social/oauth", maxAge: 0 });
    return res;
  };

  const provider = oauthProvider(platform);
  if (!provider) return finish({ error: "Bu platform için bağlantı desteklenmiyor." });
  if (!state || state.p !== provider.platform) {
    return finish({ error: "Bağlantı isteği geçersiz ya da süresi doldu — tekrar deneyin." });
  }
  const label = SOCIAL_PLATFORM_LABEL[provider.platform];
  const denied = params.get("error");
  if (denied) {
    return finish({ error: denied === "access_denied" ? `${label} izni verilmedi.` : `${label}: ${denied}` });
  }
  const code = params.get("code");
  if (!code) return finish({ error: `${label} yetkilendirme kodu dönmedi.` });

  const { session, error } = await requirePermissionApi("brands.edit");
  if (error || !session) return finish({ error: "Oturum yok ya da yetkiniz yok — panele giriş yapıp tekrar deneyin." });
  const userId = await resolveStaffUserId(session);
  if (!userId || userId !== state.u) return finish({ error: "Bağlantıyı başlatan kullanıcıyla aynı oturum gerekli." });
  const tenant = await prisma.tenant.findUnique({ where: { slug: state.t }, select: { id: true, name: true } });
  if (!tenant) return finish({ error: "Marka bulunamadı." });

  try {
    const tokens = await provider.exchangeCode(code, oauthRedirectUri(provider.platform, request));
    const profile = await provider.fetchProfile(tokens.accessToken);
    const account = await saveOAuthAccount({
      tenantId: tenant.id,
      platform: provider.platform,
      tokens,
      profile,
      connectedById: userId,
    });
    await audit(session, {
      action: "social_account.connect",
      entity: "social_account",
      entityId: account.externalId,
      tenantId: tenant.id,
      summary: `${tenant.name}: ${label} bağlandı — ${profile.name}`,
    });
    return finish({ ok: provider.platform });
  } catch (err) {
    console.error("[social-oauth]", JSON.stringify({ platform, message: (err as Error).message }));
    return finish({ error: `${label} bağlanamadı: ${(err as Error).message}`.slice(0, 300) });
  }
}
