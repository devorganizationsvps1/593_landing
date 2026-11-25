/**
 * Meta (Facebook sayfası + Instagram profesyonel hesap) paylaşımı.
 *
 * Kimlik: ajans BM system user token'ı (META_SYSTEM_USER_TOKEN). Sayfa token'ı
 * her paylaşımda bu token'la alınır, DB'de token tutulmaz. Gerekli izinler:
 * pages_show_list, pages_read_engagement, pages_manage_posts,
 * instagram_basic, instagram_content_publish (+ business_management).
 * Sayfalar BM'de system user'a "içerik oluşturma" yetkisiyle atanmış olmalı.
 *
 * POST istekleri otomatik tekrar EDİLMEZ (çift paylaşım riski); tekrar,
 * yayın motorunun yalnızca güvenli hatalarda yaptığı denemedir.
 */
import { getMetaSystemUserToken } from "@/lib/integrations/tokens";
import { publicMediaUrl } from "@/lib/social/media";
import { PublishError, type PublishContext, type PublishResult } from "@/lib/social/types";

const VERSION = "v21.0";
const GRAPH = `https://graph.facebook.com/${VERSION}`;
const GRAPH_VIDEO = `https://graph-video.facebook.com/${VERSION}`;

export const META_PUBLISH_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
] as const;

/** Geçici hata / rate limit kodları — işlem yapılmamıştır, tekrar güvenli. */
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

type GraphErr = {
  message?: string;
  code?: number;
  error_subcode?: number;
  is_transient?: boolean;
  error_user_msg?: string;
  error_user_title?: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function errorFrom(err: GraphErr, status: number): PublishError {
  const msg = err.error_user_msg || err.message || `Meta HTTP ${status}`;
  const code = err.code != null ? ` (#${err.code}${err.error_subcode ? `/${err.error_subcode}` : ""})` : "";
  const retryable = Boolean(err.is_transient) || (err.code != null && RETRYABLE_CODES.has(err.code));
  return new PublishError(`${msg}${code}`, retryable, err.code, err.error_subcode);
}

/**
 * Tek Graph çağrısı. GET'ler ağ / 5xx hatasında yeniden denenir; POST'lar
 * denenmez. `final: true` → yanıt alınamazsa durum belirsizdir, tekrar edilmez.
 */
async function call<T>(
  method: "GET" | "POST",
  url: string,
  params: Record<string, unknown>,
  opts: { final?: boolean; headers?: Record<string, string> } = {},
): Promise<T> {
  const attempts = method === "GET" ? 3 : 1;
  let lastErr: unknown = null;
  for (let i = 1; i <= attempts; i++) {
    let res: Response;
    try {
      if (method === "GET") {
        const q = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (v != null) q.set(k, String(v));
        res = await fetch(`${url}?${q}`, { headers: opts.headers });
      } else {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...opts.headers },
          body: JSON.stringify(params),
        });
      }
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        await sleep(800 * i);
        continue;
      }
      throw new PublishError(
        opts.final
          ? "Meta'ya ulaşılamadı; paylaşım durumu belirsiz — platformda kontrol edin."
          : `Meta'ya ulaşılamadı: ${(err as Error).message}`,
        !opts.final,
      );
    }
    const text = await res.text();
    let json: (T & { error?: GraphErr }) | null = null;
    try {
      json = text ? JSON.parse(text) : ({} as T);
    } catch {
      json = null;
    }
    if (json?.error) throw errorFrom(json.error, res.status);
    if (!json || res.status >= 500) {
      lastErr = new PublishError(`Meta geçersiz yanıt (HTTP ${res.status})`, method === "GET");
      if (method === "GET" && i < attempts) {
        await sleep(800 * i);
        continue;
      }
      if (opts.final) {
        throw new PublishError(
          `Meta geçersiz yanıt (HTTP ${res.status}); paylaşım durumu belirsiz — platformda kontrol edin.`,
        );
      }
      throw lastErr;
    }
    return json as T;
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/* ───────────────────────── keşif / bağlantı ───────────────────────── */

export type MetaPageOption = {
  pageId: string;
  pageName: string;
  pagePicture: string | null;
  /** Sayfa token'ı alınabiliyor mu (system user'a atanmış mı). */
  canPost: boolean;
  instagram: { id: string; username: string | null; name: string | null; picture: string | null } | null;
};

type AccountsResp = {
  data?: Array<{
    id: string;
    name: string;
    access_token?: string;
    tasks?: string[];
    picture?: { data?: { url?: string } };
    instagram_business_account?: {
      id: string;
      username?: string;
      name?: string;
      profile_picture_url?: string;
    };
  }>;
  paging?: { next?: string };
};

/** System user'a atanmış sayfalar (+ bağlı Instagram hesabı). */
export async function listMetaPages(): Promise<MetaPageOption[]> {
  const token = getMetaSystemUserToken();
  const out: MetaPageOption[] = [];
  let url: string | null = `${GRAPH}/me/accounts`;
  let params: Record<string, unknown> = {
    access_token: token,
    limit: 100,
    fields:
      "id,name,access_token,tasks,picture{url},instagram_business_account{id,username,name,profile_picture_url}",
  };
  for (let page = 0; url && page < 20; page++) {
    const resp: AccountsResp = await call<AccountsResp>("GET", url, params);
    for (const p of resp.data ?? []) {
      const ig = p.instagram_business_account;
      out.push({
        pageId: p.id,
        pageName: p.name,
        pagePicture: p.picture?.data?.url ?? null,
        canPost: Boolean(p.access_token) && (!p.tasks || p.tasks.includes("CREATE_CONTENT")),
        instagram: ig
          ? {
              id: ig.id,
              username: ig.username ?? null,
              name: ig.name ?? null,
              picture: ig.profile_picture_url ?? null,
            }
          : null,
      });
    }
    // `next` tam URL (token dahil) — parametre tekrar eklenmez.
    url = resp.paging?.next ?? null;
    params = {};
  }
  return out.sort((a, b) => a.pageName.localeCompare(b.pageName, "tr"));
}

/** Token'da eksik yayın izinleri (kontrol edilemezse null). */
export async function missingMetaPublishScopes(): Promise<string[] | null> {
  try {
    const token = getMetaSystemUserToken();
    const resp = await call<{ data?: Array<{ permission: string; status: string }> }>(
      "GET",
      `${GRAPH}/me/permissions`,
      { access_token: token },
    );
    const granted = new Set(
      (resp.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission),
    );
    return META_PUBLISH_SCOPES.filter((s) => !granted.has(s));
  } catch {
    return null;
  }
}

const pageTokenCache = new Map<string, { token: string; at: number }>();

async function pageToken(pageId: string): Promise<string> {
  const hit = pageTokenCache.get(pageId);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.token;
  const resp = await call<{ access_token?: string }>("GET", `${GRAPH}/${pageId}`, {
    access_token: getMetaSystemUserToken(),
    fields: "access_token",
  });
  if (!resp.access_token) {
    throw new PublishError(
      "Sayfa token'ı alınamadı — sayfa BM'de system user'a 'içerik' yetkisiyle atanmış mı?",
    );
  }
  pageTokenCache.set(pageId, { token: resp.access_token, at: Date.now() });
  return resp.access_token;
}

/* ───────────────────────── Instagram ───────────────────────── */

type ContainerStatus = "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";

async function igContainerStatus(id: string, token: string) {
  return call<{ status_code?: ContainerStatus; status?: string }>("GET", `${GRAPH}/${id}`, {
    access_token: token,
    fields: "status_code,status",
  });
}

/** Container hazır olana kadar bekler (video işleme dakikalar sürebilir). */
async function igWait(id: string, token: string, timeoutMs = 12 * 60_000): Promise<"FINISHED" | "PUBLISHED"> {
  const started = Date.now();
  let delay = 3000;
  while (Date.now() - started < timeoutMs) {
    const s = await igContainerStatus(id, token);
    if (s.status_code === "FINISHED" || s.status_code === "PUBLISHED") return s.status_code;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") {
      throw new PublishError(`Instagram medyayı işleyemedi: ${s.status || s.status_code}`);
    }
    await sleep(delay);
    delay = Math.min(delay * 1.5, 15_000);
  }
  // Container geçerli kalır; sonraki denemede progressRef üzerinden devam edilir.
  throw new PublishError("Instagram video işlemesi zaman aşımına uğradı; tekrar denenecek.", true);
}

async function igCreate(igId: string, token: string, params: Record<string, unknown>): Promise<string> {
  const r = await call<{ id?: string }>("POST", `${GRAPH}/${igId}/media`, { access_token: token, ...params });
  if (!r.id) throw new PublishError("Instagram medya container'ı oluşturulamadı");
  return r.id;
}

async function igItemParams(
  m: PublishContext["media"][number],
  carouselItem: boolean,
): Promise<Record<string, unknown>> {
  const url = await publicMediaUrl(m);
  if (m.kind === "image") return { image_url: url, ...(carouselItem ? { is_carousel_item: true } : {}) };
  return carouselItem ? { media_type: "VIDEO", video_url: url, is_carousel_item: true } : { video_url: url };
}

async function igBuildContainer(ctx: PublishContext, igId: string, token: string): Promise<string> {
  const { media, caption } = ctx;
  const format = ctx.target.format;
  if (format === "story") {
    return igCreate(igId, token, { media_type: "STORIES", ...(await igItemParams(media[0]!, false)) });
  }
  if (format === "reel" || (media.length === 1 && media[0]!.kind === "video")) {
    // Instagram API'de tekil feed videosu Reels olarak paylaşılır.
    return igCreate(igId, token, {
      media_type: "REELS",
      video_url: await publicMediaUrl(media[0]!),
      caption,
      share_to_feed: true,
    });
  }
  if (media.length === 1) {
    return igCreate(igId, token, { ...(await igItemParams(media[0]!, false)), caption });
  }
  const children: string[] = [];
  for (const m of media) children.push(await igCreate(igId, token, await igItemParams(m, true)));
  for (const c of children) await igWait(c, token);
  return igCreate(igId, token, { media_type: "CAROUSEL", children: children.join(","), caption });
}

/**
 * Container FINISHED olsa da Meta (özellikle hikâyelerde) yayını birkaç saniye
 * "medya bulunamıyor" (#24/2207006) ya da "hazır değil" (#9007) diye reddedebilir.
 * Bu hatalarda paylaşım yapılmamıştır: kısa bekleyip container durumunu kontrol
 * ederek tekrar denenir (PUBLISHED olduysa çift paylaşım yapılmaz).
 */
function igNotReady(err: unknown): boolean {
  return err instanceof PublishError && (err.subcode === 2207006 || err.code === 9007 || err.subcode === 2207027);
}

async function igPublish(igId: string, containerId: string, token: string): Promise<{ id?: string }> {
  const delays = [4000, 8000, 15000];
  for (let i = 0; ; i++) {
    try {
      return await call<{ id?: string }>(
        "POST",
        `${GRAPH}/${igId}/media_publish`,
        { access_token: token, creation_id: containerId },
        { final: true },
      );
    } catch (err) {
      if (!igNotReady(err) || i >= delays.length) throw err;
      await sleep(delays[i]!);
      const s = await igContainerStatus(containerId, token);
      if (s.status_code === "PUBLISHED") return { id: undefined };
    }
  }
}

export async function publishInstagram(ctx: PublishContext): Promise<PublishResult> {
  const pageId = ctx.account.parentExternalId;
  if (!pageId) throw new PublishError("Instagram hesabının bağlı Facebook sayfası yok — hesabı yeniden bağlayın.");
  const igId = ctx.account.externalId;
  const token = await pageToken(pageId);

  let containerId: string | null = null;
  if (ctx.target.progressRef) {
    try {
      const prev = JSON.parse(ctx.target.progressRef) as { container?: string };
      if (prev.container) {
        const s = await igContainerStatus(prev.container, token);
        if (s.status_code === "PUBLISHED") return { externalId: prev.container, permalink: null };
        if (s.status_code === "FINISHED" || s.status_code === "IN_PROGRESS") containerId = prev.container;
      }
    } catch {
      containerId = null;
    }
  }
  if (!containerId) {
    containerId = await igBuildContainer(ctx, igId, token);
    await ctx.saveProgress(JSON.stringify({ container: containerId }));
  }
  if ((await igWait(containerId, token)) === "PUBLISHED") {
    return { externalId: containerId, permalink: null };
  }

  const pub = await igPublish(igId, containerId, token);
  if (pub.id === undefined && (await igContainerStatus(containerId, token)).status_code === "PUBLISHED") {
    return { externalId: containerId, permalink: null };
  }
  if (!pub.id) throw new PublishError("Instagram paylaşımı onaylanmadı; platformda kontrol edin.");
  let permalink: string | null = null;
  try {
    permalink =
      (await call<{ permalink?: string }>("GET", `${GRAPH}/${pub.id}`, { access_token: token, fields: "permalink" }))
        .permalink ?? null;
  } catch {
    permalink = null;
  }
  return { externalId: pub.id, permalink };
}

/* ───────────────────────── Facebook sayfası ───────────────────────── */

async function fbPermalink(objectId: string, token: string): Promise<string | null> {
  try {
    const r = await call<{ permalink_url?: string }>("GET", `${GRAPH}/${objectId}`, {
      access_token: token,
      fields: "permalink_url",
    });
    if (!r.permalink_url) return null;
    return r.permalink_url.startsWith("http") ? r.permalink_url : `https://www.facebook.com${r.permalink_url}`;
  } catch {
    return null;
  }
}

/** Reels / video hikâyesi: start → rupload (file_url) → finish. */
async function fbResumableVideo(
  edge: "video_reels" | "video_stories",
  pageId: string,
  token: string,
  fileUrl: string,
  finishParams: Record<string, unknown>,
): Promise<{ videoId: string; postId: string | null }> {
  const start = await call<{ video_id?: string; upload_url?: string }>("POST", `${GRAPH}/${pageId}/${edge}`, {
    access_token: token,
    upload_phase: "start",
  });
  if (!start.video_id || !start.upload_url) throw new PublishError("Facebook video yüklemesi başlatılamadı");
  await call<{ success?: boolean }>("POST", start.upload_url, {}, {
    headers: { Authorization: `OAuth ${token}`, file_url: fileUrl },
  });
  const fin = await call<{ success?: boolean; post_id?: string }>(
    "POST",
    `${GRAPH}/${pageId}/${edge}`,
    { access_token: token, upload_phase: "finish", video_id: start.video_id, ...finishParams },
    { final: true },
  );
  if (fin.success === false) throw new PublishError("Facebook video paylaşımı tamamlanamadı");
  return { videoId: start.video_id, postId: fin.post_id ?? null };
}

export async function publishFacebook(ctx: PublishContext): Promise<PublishResult> {
  const pageId = ctx.account.externalId;
  const token = await pageToken(pageId);
  const { media, caption } = ctx;
  const format = ctx.target.format;

  if (format === "reel") {
    const r = await fbResumableVideo("video_reels", pageId, token, await publicMediaUrl(media[0]!), {
      video_state: "PUBLISHED",
      description: caption,
    });
    return { externalId: r.videoId, permalink: await fbPermalink(r.videoId, token) };
  }

  if (format === "story") {
    const m = media[0]!;
    if (m.kind === "video") {
      const r = await fbResumableVideo("video_stories", pageId, token, await publicMediaUrl(m), {});
      return { externalId: r.postId ?? r.videoId, permalink: null };
    }
    const photo = await call<{ id?: string }>("POST", `${GRAPH}/${pageId}/photos`, {
      access_token: token,
      url: await publicMediaUrl(m),
      published: false,
    });
    if (!photo.id) throw new PublishError("Facebook hikâye görseli yüklenemedi");
    const story = await call<{ post_id?: string; success?: boolean }>(
      "POST",
      `${GRAPH}/${pageId}/photo_stories`,
      { access_token: token, photo_id: photo.id },
      { final: true },
    );
    return { externalId: story.post_id ?? photo.id, permalink: null };
  }

  // Gönderi
  if (media.length === 1 && media[0]!.kind === "video") {
    const v = await call<{ id?: string }>(
      "POST",
      `${GRAPH_VIDEO}/${pageId}/videos`,
      { access_token: token, file_url: await publicMediaUrl(media[0]!), description: caption },
      { final: true },
    );
    if (!v.id) throw new PublishError("Facebook videosu yüklenemedi");
    return { externalId: v.id, permalink: await fbPermalink(v.id, token) };
  }
  if (media.length === 1) {
    const p = await call<{ id?: string; post_id?: string }>(
      "POST",
      `${GRAPH}/${pageId}/photos`,
      { access_token: token, url: await publicMediaUrl(media[0]!), message: caption },
      { final: true },
    );
    const id = p.post_id ?? p.id;
    if (!id) throw new PublishError("Facebook fotoğrafı paylaşılamadı");
    return { externalId: id, permalink: await fbPermalink(id, token) };
  }
  const attached: Array<{ media_fbid: string }> = [];
  for (const m of media) {
    const p = await call<{ id?: string }>("POST", `${GRAPH}/${pageId}/photos`, {
      access_token: token,
      url: await publicMediaUrl(m),
      published: false,
    });
    if (!p.id) throw new PublishError("Facebook fotoğrafı yüklenemedi");
    attached.push({ media_fbid: p.id });
  }
  const post = await call<{ id?: string }>(
    "POST",
    `${GRAPH}/${pageId}/feed`,
    { access_token: token, message: caption, ...(attached.length ? { attached_media: attached } : {}) },
    { final: true },
  );
  if (!post.id) throw new PublishError("Facebook gönderisi oluşturulamadı");
  return { externalId: post.id, permalink: await fbPermalink(post.id, token) };
}
