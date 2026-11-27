import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermissionApi, resolveStaffUserId } from "@/lib/panel/staff-auth";
import {
  encodeState,
  newNonce,
  OAUTH_NONCE_COOKIE,
  OAUTH_STATE_TTL_SEC,
  oauthBaseUrl,
  oauthRedirectUri,
} from "@/lib/social/oauth";
import { oauthProvider } from "@/lib/social/oauth-providers";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ platform: string }> };

/**
 * GET ?tenant=<slug> — markanın hesabını bağlamak için platformun izin
 * ekranına yönlendirir. Panelden düz bağlantı olarak açılır.
 */
export async function GET(request: NextRequest, ctx: Ctx) {
  const { platform } = await ctx.params;
  const slug = request.nextUrl.searchParams.get("tenant") ?? "";
  const back = (msg: string) => {
    const url = new URL(slug ? `/brands/${encodeURIComponent(slug)}` : "/paylasimlar", oauthBaseUrl(request));
    url.searchParams.set("social_error", msg);
    url.hash = "sosyal-hesaplar";
    return NextResponse.redirect(url);
  };

  const { session, error } = await requirePermissionApi("brands.edit");
  if (error || !session) return error;
  const provider = oauthProvider(platform);
  if (!provider) return back("Bu platform için bağlantı desteklenmiyor.");
  if (!provider.configured()) return back(provider.configHint);

  const tenant = slug ? await prisma.tenant.findUnique({ where: { slug }, select: { id: true } }) : null;
  if (!tenant) return back("Marka bulunamadı.");
  const userId = await resolveStaffUserId(session);
  if (!userId) return back("Oturum kullanıcısı bulunamadı.");

  const nonce = newNonce();
  const state = encodeState({ t: slug, p: provider.platform, u: userId, n: nonce });
  const res = NextResponse.redirect(
    provider.authorizeUrl({ state, redirectUri: oauthRedirectUri(provider.platform, request) }),
  );
  res.cookies.set(OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/social/oauth",
    maxAge: OAUTH_STATE_TTL_SEC,
  });
  return res;
}
