/**
 * YouTube: marka kanalı Google OAuth ile bağlanır; video Data API v3
 * `videos.insert` ile kesintiye dayanıklı (resumable) yüklenir.
 *
 * Kimlik: YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET (yoksa GOOGLE_CLIENT_ID /
 * GOOGLE_CLIENT_SECRET). OAuth istemcisi "Web application" türünde olmalı ve
 * yönlendirme adresi olarak `<panel>/api/social/oauth/youtube/callback`
 * kayıtlı olmalı.
 *
 * Çift paylaşım koruması: yükleme oturumu adresi ve bitince video id'si
 * `progressRef`'e yazılır. Yeniden denemede yarım yükleme kaldığı yerden
 * sürer, tamamlanmış video ikinci kez yüklenmez.
 *
 * Not: Google denetiminden geçmemiş projelerde yüklenen videolar YouTube
 * tarafından "Gizli"ye çekilir; kota varsayılanı günde ~6 yüklemedir.
 */
import { headMedia, readMediaRange } from "@/lib/social/media";
import {
  accessTokenFor,
  OAuthRevokedError,
  type OAuthProfile,
  type OAuthProvider,
  type OAuthTokens,
} from "@/lib/social/oauth";
import { YOUTUBE_TITLE_LIMIT } from "@/lib/social/formats";
import { PublishError, type PublishContext, type PublishResult } from "@/lib/social/types";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/youtube/v3/videos";

export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

/** 256 KiB'ın katı olmalı (son parça hariç). */
const CHUNK_BYTES = 16 * 1024 * 1024;
const CHUNK_TIMEOUT_MS = 3 * 60_000;
/** Parça başına ağ / 5xx hatasında yerinde deneme. */
const CHUNK_RETRIES = 4;
/** Uzun yüklemede kilit bayatlamasın diye bu aralıkla `lockedAt` tazelenir. */
const HEARTBEAT_MS = 60_000;

function creds(): { id: string; secret: string } | null {
  const id = (process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID)?.trim();
  const secret = (process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET)?.trim();
  return id && secret ? { id, secret } : null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type TokenResp = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(params: Record<string, string>): Promise<OAuthTokens> {
  const c = creds();
  if (!c) throw new Error("YouTube OAuth istemcisi tanımlı değil.");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, ...params }),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResp;
  if (!res.ok || !json.access_token) {
    // invalid_grant: refresh token geri alınmış / süresi dolmuş (Testing modunda 7 gün).
    if (json.error === "invalid_grant" && params.grant_type === "refresh_token") {
      throw new OAuthRevokedError(json.error_description || "invalid_grant");
    }
    throw new Error(json.error_description || json.error || `Google HTTP ${res.status}`);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresIn: json.expires_in ?? null,
    scopes: json.scope ? json.scope.split(" ") : [],
  };
}

type ApiErr = { error?: { code?: number; message?: string; errors?: Array<{ reason?: string; message?: string }> } };

const RETRYABLE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "backendError", "internalError"]);

function apiError(json: ApiErr | null, status: number, retryableDefault = false): PublishError {
  const reason = json?.error?.errors?.[0]?.reason;
  const raw = json?.error?.message || json?.error?.errors?.[0]?.message || `YouTube HTTP ${status}`;
  switch (reason) {
    case "quotaExceeded":
      return new PublishError("YouTube günlük API kotası doldu (Pasifik saatiyle gece yarısı sıfırlanır).", false, status);
    case "uploadLimitExceeded":
      return new PublishError("Kanalın günlük video yükleme sınırı doldu.", false, status);
    case "youtubeSignupRequired":
      return new PublishError("Bu Google hesabının YouTube kanalı yok.", false, status);
    case "forbidden":
    case "insufficientPermissions":
      return new PublishError("YouTube yükleme izni yok — kanalı yeniden bağlayın.", false, status);
    case "invalidTitle":
      return new PublishError("YouTube başlığı geçersiz.", false, status);
    case "invalidDescription":
      return new PublishError("YouTube açıklaması geçersiz.", false, status);
  }
  const retryable = retryableDefault || status >= 500 || (reason != null && RETRYABLE_REASONS.has(reason));
  return new PublishError(`YouTube: ${raw}${reason ? ` (${reason})` : ""}`, retryable, status);
}

/* ───────────────────────── OAuth sağlayıcısı ───────────────────────── */

export const youtubeOAuth: OAuthProvider = {
  platform: "youtube",
  configured: () => creds() != null,
  configHint: "YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET (ya da GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) tanımlı değil.",

  authorizeUrl({ state, redirectUri }) {
    const c = creds();
    if (!c) throw new Error(this.configHint);
    const q = new URLSearchParams({
      client_id: c.id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: YOUTUBE_SCOPES.join(" "),
      access_type: "offline",
      // Her seferinde refresh token verilmesi için.
      prompt: "consent select_account",
      include_granted_scopes: "false",
      state,
    });
    return `${AUTH_URL}?${q}`;
  },

  exchangeCode(code, redirectUri) {
    return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  },

  refresh(refreshToken) {
    return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  },

  async fetchProfile(accessToken): Promise<OAuthProfile> {
    const res = await fetch(`${API}/channels?part=snippet&mine=true`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = (await res.json().catch(() => null)) as
      | (ApiErr & {
          items?: Array<{
            id: string;
            snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } };
          }>;
        })
      | null;
    if (!res.ok) throw apiError(json, res.status);
    const ch = json?.items?.[0];
    if (!ch) throw new Error("Seçilen Google hesabında YouTube kanalı yok. Kanal sahibi hesapla tekrar deneyin.");
    return {
      externalId: ch.id,
      name: ch.snippet?.title || "YouTube kanalı",
      username: ch.snippet?.customUrl?.replace(/^@/, "") || null,
      pictureUrl: ch.snippet?.thumbnails?.default?.url ?? null,
    };
  },

  async revoke(token) {
    await fetch(`${REVOKE_URL}?${new URLSearchParams({ token })}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }).catch(() => undefined);
  },
};

/* ───────────────────────── yükleme ───────────────────────── */

type Ref = { kind: "upload"; url: string } | { kind: "video"; id: string };

function parseRef(ref: string | null): Ref | null {
  if (!ref) return null;
  if (ref.startsWith("yt:video:")) return { kind: "video", id: ref.slice(9) };
  if (ref.startsWith("yt:upload:")) return { kind: "upload", url: ref.slice(10) };
  return null;
}

/** YouTube başlık / açıklamada < ve > kabul etmez. */
function clean(s: string): string {
  return s.replace(/[<>]/g, "");
}

function buildMetadata(ctx: PublishContext) {
  const { target, caption } = ctx;
  const title = clean(target.title?.trim() || caption.split("\n")[0] || "Video").slice(0, YOUTUBE_TITLE_LIMIT);
  let description = clean(caption);
  if (target.format === "short" && !/#shorts\b/i.test(description) && !/#shorts\b/i.test(title)) {
    description = description ? `${description}\n\n#Shorts` : "#Shorts";
  }
  const privacy = ["public", "unlisted", "private"].includes(target.privacy ?? "") ? target.privacy! : "public";
  return {
    snippet: { title, description: description.slice(0, 5000), categoryId: "22" },
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
  };
}

function permalinkFor(id: string, short: boolean): string {
  return short ? `https://www.youtube.com/shorts/${id}` : `https://youtu.be/${id}`;
}

type UploadStatus = { done: true; id: string } | { done: false; next: number } | { expired: true };

/** 308 yanıtındaki `Range: bytes=0-N` → sıradaki bayt. */
function nextOffset(res: Response): number {
  const m = /bytes=0-(\d+)/.exec(res.headers.get("range") ?? "");
  return m ? Number(m[1]) + 1 : 0;
}

async function readVideoId(res: Response): Promise<string> {
  const json = (await res.json().catch(() => null)) as { id?: string } | null;
  if (!json?.id) throw new PublishError("YouTube yüklemeyi tamamladı ama video kimliği dönmedi — kanalda kontrol edin.");
  return json.id;
}

export async function publishYoutube(ctx: PublishContext): Promise<PublishResult> {
  const { target, account } = ctx;
  const short = target.format === "short";
  const video = ctx.media.find((m) => m.kind === "video");
  if (!video) throw new PublishError("YouTube için video gerekli.");

  const ref = parseRef(target.progressRef);
  if (ref?.kind === "video") return { externalId: ref.id, permalink: permalinkFor(ref.id, short) };

  const size = await headMedia(video.storageKey);
  if (!size) throw new PublishError("Video dosyası depoda bulunamadı.");

  let token = await accessTokenFor(account, youtubeOAuth);
  const authed = async (fn: (t: string) => Promise<Response>): Promise<Response> => {
    let res = await fn(token);
    if (res.status === 401) {
      token = await accessTokenFor(account, youtubeOAuth, { force: true });
      res = await fn(token);
    }
    return res;
  };

  let lastBeat = Date.now();
  let currentRef: string | null = target.progressRef;
  const save = async (r: string | null) => {
    currentRef = r;
    lastBeat = Date.now();
    await ctx.saveProgress(r);
  };
  const heartbeat = async () => {
    if (Date.now() - lastBeat > HEARTBEAT_MS) await save(currentRef);
  };

  const finish = async (id: string): Promise<PublishResult> => {
    await save(`yt:video:${id}`);
    return { externalId: id, permalink: permalinkFor(id, short) };
  };

  /** Yükleme oturumunun durumu (nereden devam edileceği). */
  const status = async (url: string): Promise<UploadStatus> => {
    const res = await authed((t) =>
      fetch(url, {
        method: "PUT",
        headers: { Authorization: `Bearer ${t}`, "Content-Range": `bytes */${size}`, "Content-Length": "0" },
        signal: AbortSignal.timeout(30_000),
      }),
    );
    if (res.status === 200 || res.status === 201) return { done: true, id: await readVideoId(res) };
    if (res.status === 308) return { done: false, next: nextOffset(res) };
    if (res.status === 404 || res.status === 410) return { expired: true };
    throw apiError(await res.json().catch(() => null), res.status, res.status >= 500);
  };

  let session = ref?.kind === "upload" ? ref.url : null;
  let offset = 0;
  if (session) {
    try {
      const st = await status(session);
      if ("expired" in st) session = null;
      else if (st.done) return finish(st.id);
      else offset = st.next;
    } catch (err) {
      if (err instanceof PublishError) throw err;
      throw new PublishError(`YouTube'a ulaşılamadı: ${(err as Error).message}`, true);
    }
  }

  if (!session) {
    // Oturum açmak video oluşturmaz → hata olursa tekrar güvenli.
    let res: Response;
    try {
      res = await authed((t) =>
        fetch(`${UPLOAD_API}?uploadType=resumable&part=snippet,status`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${t}`,
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": video.mimeType,
            "X-Upload-Content-Length": String(size),
          },
          body: JSON.stringify(buildMetadata(ctx)),
          signal: AbortSignal.timeout(30_000),
        }),
      );
    } catch (err) {
      throw new PublishError(`YouTube'a ulaşılamadı: ${(err as Error).message}`, true);
    }
    const location = res.headers.get("location");
    if (!res.ok || !location) throw apiError(await res.json().catch(() => null), res.status, res.status >= 500);
    session = location;
    offset = 0;
    await save(`yt:upload:${session}`);
  }

  // Parça parça yükle; ağ / 5xx hatasında oturumdan kalınan yeri sorup sürdür.
  let failures = 0;
  while (offset < size) {
    await heartbeat();
    const end = Math.min(offset + CHUNK_BYTES, size) - 1;
    let res: Response | null = null;
    try {
      const chunk = await readMediaRange(video.storageKey, offset, end);
      const body = new Uint8Array(chunk);
      res = await authed((t) =>
        fetch(session!, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${t}`,
            "Content-Type": video.mimeType,
            "Content-Length": String(body.byteLength),
            "Content-Range": `bytes ${offset}-${end}/${size}`,
          },
          body,
          signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
        }),
      );
    } catch (err) {
      if (err instanceof PublishError) throw err;
      res = null;
    }

    if (res && (res.status === 200 || res.status === 201)) return finish(await readVideoId(res));
    if (res && res.status === 308) {
      offset = nextOffset(res);
      failures = 0;
      continue;
    }
    if (res && (res.status === 404 || res.status === 410)) {
      // Oturum düşmüş — video oluşmadı; sonraki denemede baştan.
      await save(null);
      throw new PublishError("YouTube yükleme oturumu sona erdi; yeniden denenecek.", true);
    }
    if (res && res.status < 500) throw apiError(await res.json().catch(() => null), res.status);

    // Ağ hatası / 5xx: bekle, durumu sor, kaldığı yerden devam et.
    if (++failures > CHUNK_RETRIES) {
      throw new PublishError("YouTube yüklemesi kesildi; kaldığı yerden yeniden denenecek.", true);
    }
    await sleep(2000 * 2 ** (failures - 1));
    let st: UploadStatus | null = null;
    try {
      st = await status(session);
    } catch (err) {
      if (err instanceof PublishError && !err.retryable) throw err;
      // Durum da alınamadı — döngü aynı aralığı tekrar dener.
    }
    if (st && "expired" in st) {
      await save(null);
      throw new PublishError("YouTube yükleme oturumu sona erdi; yeniden denenecek.", true);
    }
    if (st?.done) return finish(st.id);
    if (st) offset = st.next;
  }
  // Tüm baytlar gönderildi ama tamamlanma yanıtı alınamadı.
  const st = await status(session);
  if ("done" in st && st.done) return finish(st.id);
  throw new PublishError("YouTube yüklemesi tamamlanamadı; yeniden denenecek.", true);
}

