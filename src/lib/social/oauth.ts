/**
 * Marka başına OAuth ile bağlanan hesaplar (YouTube; ileride TikTok, Pinterest).
 *
 * Akış: panel → /api/social/oauth/<platform>/start → platform izin ekranı →
 * /api/social/oauth/<platform>/callback → SocialAccount (token'lar şifreli).
 * `state` HMAC imzalı ve tarayıcıdaki tek kullanımlık nonce çerezine bağlı
 * (CSRF / başka markaya bağlama girişimi engellenir).
 *
 * Yayın sırasında `accessTokenFor` süresi dolan token'ı yeniler; yenileme
 * kalıcı olarak reddedilirse hesap "yeniden bağlanmalı" durumuna düşer.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SocialAccount } from "@prisma/client";
import { prisma } from "@/lib/db";
import { openToken, sealToken } from "@/lib/crypto/token-box";
import { publicBaseUrl } from "@/lib/social/media";
import { SOCIAL_PLATFORM_LABEL, type SocialPlatformKey } from "@/lib/social/formats";
import { PublishError } from "@/lib/social/types";

export type OAuthTokens = {
  accessToken: string;
  /** Platform yenilerken yeni refresh token vermeyebilir → eskisi korunur. */
  refreshToken?: string | null;
  /** Saniye. */
  expiresIn?: number | null;
  scopes?: string[];
};

export type OAuthProfile = {
  externalId: string;
  name: string;
  username: string | null;
  pictureUrl: string | null;
};

export type OAuthProvider = {
  platform: SocialPlatformKey;
  /** İstemci kimliği / gizli anahtar tanımlı mı. */
  configured(): boolean;
  /** Eksik yapılandırmanın açıklaması (UI / sağlık ekranı). */
  configHint: string;
  authorizeUrl(opts: { state: string; redirectUri: string }): string;
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens>;
  refresh(refreshToken: string): Promise<OAuthTokens>;
  fetchProfile(accessToken: string): Promise<OAuthProfile>;
  /** Bağlantı kaldırılınca platformdaki izni de geri al (en iyi çaba). */
  revoke?(token: string): Promise<void>;
};

/** Refresh token geçersiz / izin geri alınmış — yeniden bağlanmadan düzelmez. */
export class OAuthRevokedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthRevokedError";
  }
}

export const RECONNECT_MESSAGE = "Bağlantının süresi doldu ya da izin geri alındı — hesabı yeniden bağlayın.";

/* ───────────────────────── state + nonce ───────────────────────── */

export const OAUTH_NONCE_COOKIE = "social_oauth_nonce";
export const OAUTH_STATE_TTL_SEC = 10 * 60;

export type OAuthState = {
  /** Marka slug'ı. */
  t: string;
  p: SocialPlatformKey;
  /** Başlatan staff kullanıcı id'si. */
  u: string;
  n: string;
  /** Bitiş (unix sn). */
  e: number;
};

function secret(): string {
  const s = process.env.AUTH_SECRET?.trim();
  if (!s) throw new Error("AUTH_SECRET tanımlı değil");
  return s;
}

function mac(payload: string): string {
  return createHmac("sha256", secret()).update(`oauth-state:${payload}`).digest("base64url");
}

export function newNonce(): string {
  return randomBytes(18).toString("base64url");
}

export function encodeState(s: Omit<OAuthState, "e">): string {
  const payload = Buffer.from(
    JSON.stringify({ ...s, e: Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SEC }),
  ).toString("base64url");
  return `${payload}.${mac(payload)}`;
}

/** İmza, süre ve çerezdeki nonce doğrulanır; geçersizse null. */
export function decodeState(raw: string | null, nonceCookie: string | null | undefined): OAuthState | null {
  if (!raw || !nonceCookie) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return null;
  const a = Buffer.from(mac(payload));
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let s: OAuthState;
  try {
    s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
  } catch {
    return null;
  }
  if (!s || typeof s.e !== "number" || s.e * 1000 < Date.now()) return null;
  const n1 = Buffer.from(String(s.n));
  const n2 = Buffer.from(nonceCookie);
  if (n1.length !== n2.length || !timingSafeEqual(n1, n2)) return null;
  return s;
}

/**
 * Platform paneline kayıtlı olması gereken dönüş adresi. Prod'da sabit kök
 * (PUBLIC_APP_URL / admin.<root>); geliştirmede isteğin geldiği host.
 */
export function oauthRedirectUri(platform: SocialPlatformKey, request: Request): string {
  return `${oauthBaseUrl(request)}/api/social/oauth/${platform}/callback`;
}

export function oauthBaseUrl(request: Request): string {
  if (process.env.NODE_ENV === "production") return publicBaseUrl();
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  return host ? `http://${host}` : new URL(request.url).origin;
}

/* ───────────────────────── hesap kaydı ───────────────────────── */

export async function saveOAuthAccount(opts: {
  tenantId: string;
  platform: SocialPlatformKey;
  tokens: OAuthTokens;
  profile: OAuthProfile;
  connectedById: string | null;
}): Promise<SocialAccount> {
  const { tokens, profile } = opts;
  if (!tokens.refreshToken) {
    throw new Error("Platform yenileme anahtarı (refresh token) vermedi; bağlantı kalıcı olmaz.");
  }
  const data = {
    externalId: profile.externalId,
    name: profile.name,
    username: profile.username,
    pictureUrl: profile.pictureUrl,
    authSource: "oauth",
    accessTokenEnc: sealToken(tokens.accessToken),
    refreshTokenEnc: sealToken(tokens.refreshToken),
    tokenExpiresAt: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : null,
    scopes: tokens.scopes ?? [],
    parentExternalId: null,
    status: "active",
    lastError: null,
    connectedById: opts.connectedById,
  };
  return prisma.socialAccount.upsert({
    where: { tenantId_platform: { tenantId: opts.tenantId, platform: opts.platform } },
    create: { tenantId: opts.tenantId, platform: opts.platform, ...data },
    update: data,
  });
}

/* ───────────────────────── geçerli access token ───────────────────────── */

/** Bitişe bu kadar kala yenilenir (uzun yüklemeler için pay). */
const REFRESH_MARGIN_MS = 5 * 60_000;
const inflight = new Map<string, Promise<string>>();

async function markReconnect(accountId: string): Promise<void> {
  await prisma.socialAccount.update({
    where: { id: accountId },
    data: { status: "error", lastError: RECONNECT_MESSAGE },
  });
}

async function doRefresh(account: SocialAccount, provider: OAuthProvider): Promise<string> {
  const label = SOCIAL_PLATFORM_LABEL[provider.platform];
  const refresh = openToken(account.refreshTokenEnc);
  if (!refresh) {
    await markReconnect(account.id);
    throw new PublishError(`${label}: ${RECONNECT_MESSAGE}`);
  }
  let tokens: OAuthTokens;
  try {
    tokens = await provider.refresh(refresh);
  } catch (err) {
    if (err instanceof OAuthRevokedError) {
      await markReconnect(account.id);
      throw new PublishError(`${label}: ${RECONNECT_MESSAGE}`);
    }
    // Ağ / geçici hata: hiçbir şey paylaşılmadı, tekrar güvenli.
    throw new PublishError(`${label} oturumu yenilenemedi: ${(err as Error).message}`, true);
  }
  const updated = await prisma.socialAccount.update({
    where: { id: account.id },
    data: {
      accessTokenEnc: sealToken(tokens.accessToken),
      ...(tokens.refreshToken ? { refreshTokenEnc: sealToken(tokens.refreshToken) } : {}),
      tokenExpiresAt: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : null,
      ...(account.status === "error" && account.lastError === RECONNECT_MESSAGE
        ? { status: "active", lastError: null }
        : {}),
    },
  });
  Object.assign(account, updated);
  return tokens.accessToken;
}

/**
 * Yayın için geçerli access token. `force` → 401 alındıysa süresine
 * bakmadan yenile. Aynı hesap için eşzamanlı yenilemeler tek istekte birleşir.
 */
export async function accessTokenFor(
  account: SocialAccount,
  provider: OAuthProvider,
  opts: { force?: boolean } = {},
): Promise<string> {
  if (account.authSource !== "oauth") {
    throw new PublishError(`${SOCIAL_PLATFORM_LABEL[provider.platform]} hesabı OAuth ile bağlanmamış.`);
  }
  if (!opts.force) {
    const current = openToken(account.accessTokenEnc);
    const exp = account.tokenExpiresAt?.getTime() ?? 0;
    if (current && exp > Date.now() + REFRESH_MARGIN_MS) return current;
  }
  const running = inflight.get(account.id);
  if (running) return running;
  const p = doRefresh(account, provider).finally(() => inflight.delete(account.id));
  inflight.set(account.id, p);
  return p;
}
