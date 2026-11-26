/**
 * /paylasimlar — otomatik paylaşım genel görünümü: sistem sağlığı, sayaçlar,
 * paylaşım listesi ve marka × platform hesap tablosu.
 */
import { prisma } from "@/lib/db";
import { IntegrationNotConfiguredError } from "@/lib/integrations/tokens";
import { PUBLISHER_READY, type PublishFormat, type SocialPlatformKey } from "@/lib/social/formats";
import { createUploadTarget, previewUrl, publicBaseUrl } from "@/lib/social/media";
import { AUTO_PUBLISH_STATUSES } from "@/lib/panel/content-posts";
import { listMetaPages, missingMetaPublishScopes } from "@/lib/social/meta";
import { s3Enabled } from "@/lib/storage/s3";

export const SCHEDULER_SETTING_KEY = "social_publish_last_run";
const SCHEDULER_INTERVAL_MS = 60_000;

/* ───────────────────────── zamanlayıcı kaydı ───────────────────────── */

/** Her tick sonunda çağrılır; sağlık kartı "son çalışma" bilgisini buradan okur. */
export async function recordSchedulerRun(r: { claimed: number; error?: string | null }): Promise<void> {
  const value = { at: new Date().toISOString(), claimed: r.claimed, error: r.error ?? null };
  await prisma.appSetting.upsert({
    where: { key: SCHEDULER_SETTING_KEY },
    create: { key: SCHEDULER_SETTING_KEY, value },
    update: { value },
  });
}

/* ───────────────────────── sağlık ───────────────────────── */

/** `info`: bilgi amaçlı — genel sistem durumunu etkilemez. */
export type HealthLevel = "ok" | "info" | "warn" | "error";

export type HealthItem = {
  key: string;
  label: string;
  level: HealthLevel;
  summary: string;
  detail?: string | null;
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("zaman aşımı")), ms)),
  ]);
}

async function metaHealth(): Promise<HealthItem> {
  const label = "Meta (Instagram + Facebook)";
  try {
    const [missing, pages] = await withTimeout(Promise.all([missingMetaPublishScopes(), listMetaPages()]), 8000);
    if (missing === null) {
      return { key: "meta", label, level: "warn", summary: "Token izinleri okunamadı", detail: null };
    }
    if (missing.length) {
      return {
        key: "meta",
        label,
        level: "error",
        summary: "Token'da yayın izinleri eksik",
        detail: missing.join(", "),
      };
    }
    const postable = pages.filter((p) => p.canPost).length;
    if (postable === 0) {
      return {
        key: "meta",
        label,
        level: "warn",
        summary: "İzinler tam, ama system user'a atanmış sayfa yok",
        detail: "Business Settings → Sistem kullanıcıları → Varlık ata → Sayfalar (İçerik yetkisi).",
      };
    }
    const ig = pages.filter((p) => p.instagram).length;
    return {
      key: "meta",
      label,
      level: "ok",
      summary: `İzinler tam · ${postable} sayfa · ${ig} Instagram hesabı erişilebilir`,
    };
  } catch (err) {
    return {
      key: "meta",
      label,
      level: "error",
      summary: err instanceof IntegrationNotConfiguredError ? "Meta token tanımlı değil" : "Meta'ya ulaşılamadı",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function storageHealth(): Promise<HealthItem> {
  const label = "Medya depolama (S3)";
  if (!s3Enabled()) {
    return {
      key: "storage",
      label,
      level: "warn",
      summary: "S3 tanımlı değil — dosyalar sunucu diskine yazılıyor",
      detail: "Büyük videolar ve redeploy sonrası kalıcılık için S3_BUCKET ayarlayın.",
    };
  }
  try {
    const origin = new URL(publicBaseUrl()).origin;
    const t = await createUploadTarget({ postId: "healthcheck", mime: "image/jpeg" });
    const res = await withTimeout(
      fetch(t.uploadUrl, {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "PUT",
          "Access-Control-Request-Headers": "content-type",
        },
      }),
      6000,
    );
    const allowed = res.headers.get("access-control-allow-origin");
    if (res.ok && (allowed === origin || allowed === "*")) {
      return { key: "storage", label, level: "ok", summary: "Tarayıcıdan yükleme açık (CORS)" };
    }
    return {
      key: "storage",
      label,
      level: "error",
      summary: "Bucket CORS'u panelden yüklemeye kapalı",
      detail: `${origin} için PUT izni verin (AWS → S3 → Permissions → CORS).`,
    };
  } catch (err) {
    return {
      key: "storage",
      label,
      level: "warn",
      summary: "CORS kontrol edilemedi",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function schedulerHealth(): Promise<HealthItem> {
  const label = "Zamanlayıcı";
  if (process.env.SOCIAL_PUBLISH_DISABLED === "true") {
    return { key: "scheduler", label, level: "error", summary: "Kapalı (SOCIAL_PUBLISH_DISABLED=true)" };
  }
  const row = await prisma.appSetting.findUnique({ where: { key: SCHEDULER_SETTING_KEY } });
  const v = (row?.value ?? null) as { at?: string; claimed?: number; error?: string | null } | null;
  if (!v?.at) {
    return {
      key: "scheduler",
      label,
      level: process.env.NODE_ENV === "production" ? "warn" : "ok",
      summary:
        process.env.NODE_ENV === "production"
          ? "Henüz çalışmadı (uygulama yeni başladıysa 1 dk bekleyin)"
          : "Geliştirme ortamında zamanlayıcı çalışmaz",
    };
  }
  const ageMs = Date.now() - new Date(v.at).getTime();
  const ago = ageMs < 90_000 ? "az önce" : `${Math.round(ageMs / 60_000)} dk önce`;
  if (v.error) {
    return { key: "scheduler", label, level: "error", summary: `Son çalışma hatalı (${ago})`, detail: v.error };
  }
  if (ageMs > SCHEDULER_INTERVAL_MS * 5) {
    return {
      key: "scheduler",
      label,
      level: "error",
      summary: `Son çalışma ${ago} — zamanlayıcı durmuş olabilir`,
      detail: "Uygulama loglarında [social-publish] satırlarını kontrol edin.",
    };
  }
  return { key: "scheduler", label, level: "ok", summary: `Çalışıyor · son kontrol ${ago}` };
}

function platformHealth(): HealthItem {
  const off = (Object.keys(PUBLISHER_READY) as SocialPlatformKey[]).filter((p) => !PUBLISHER_READY[p]);
  return {
    key: "platforms",
    label: "TikTok + YouTube",
    level: off.length ? "info" : "ok",
    summary: off.length ? "Sonraki aşamada (OAuth + uygulama onayı)" : "Etkin",
  };
}

export async function loadSocialHealth(): Promise<HealthItem[]> {
  const [meta, storage, scheduler] = await Promise.all([metaHealth(), storageHealth(), schedulerHealth()]);
  return [meta, storage, scheduler, platformHealth()];
}

/* ───────────────────────── sayaçlar ───────────────────────── */

export type SocialCounts = {
  queued: number;
  dueToday: number;
  published7d: number;
  failed: number;
};

function istanbulDayBounds(now = new Date()): { start: Date; end: Date } {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(now);
  // İstanbul sabit UTC+3.
  const start = new Date(`${ymd}T00:00:00+03:00`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

export async function loadSocialCounts(): Promise<SocialCounts> {
  const { start, end } = istanbulDayBounds();
  const [queued, dueToday, published7d, failed] = await Promise.all([
    prisma.contentPostTarget.count({
      where: {
        status: { in: ["pending", "publishing"] },
        post: { autoPublish: true, status: { in: AUTO_PUBLISH_STATUSES } },
      },
    }),
    prisma.contentPostTarget.count({
      where: { status: { in: ["pending", "publishing"] }, post: { scheduledAt: { gte: start, lt: end } } },
    }),
    prisma.contentPostTarget.count({
      where: { status: "published", publishedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
    }),
    prisma.contentPostTarget.count({ where: { status: "failed" } }),
  ]);
  return { queued, dueToday, published7d, failed };
}

/* ───────────────────────── liste ───────────────────────── */

export type TargetRow = {
  id: string;
  postId: string;
  postTitle: string;
  captionPreview: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  platform: SocialPlatformKey;
  format: PublishFormat;
  status: "pending" | "publishing" | "published" | "failed";
  autoPublish: boolean;
  /** İçerik onaylandı mı — otomatik paylaşım yalnızca onaylı içerikte çalışır. */
  approved: boolean;
  scheduledAt: string;
  publishedAt: string | null;
  nextAttemptAt: string | null;
  attempts: number;
  permalink: string | null;
  lastError: string | null;
  account: string | null;
  thumb: { url: string; kind: "image" | "video" } | null;
  mediaCount: number;
};

export async function listSocialTargets(): Promise<TargetRow[]> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await prisma.contentPostTarget.findMany({
    where: {
      OR: [
        { status: { in: ["pending", "publishing", "failed"] } },
        { status: "published", publishedAt: { gte: since } },
      ],
    },
    include: {
      account: { select: { name: true, username: true } },
      post: {
        select: {
          id: true,
          title: true,
          caption: true,
          scheduledAt: true,
          autoPublish: true,
          status: true,
          tenant: { select: { id: true, name: true, slug: true } },
          media: {
            orderBy: [{ position: "asc" }, { createdAt: "asc" }],
            select: { id: true, kind: true },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  return rows.map((t) => {
    const first = t.post.media[0];
    return {
      id: t.id,
      postId: t.postId,
      postTitle: t.post.title,
      captionPreview: (t.captionOverride?.trim() || t.post.caption).replace(/\s+/g, " ").slice(0, 140),
      tenantId: t.post.tenant.id,
      tenantName: t.post.tenant.name,
      tenantSlug: t.post.tenant.slug,
      platform: t.platform as SocialPlatformKey,
      format: t.format as PublishFormat,
      status: t.status,
      autoPublish: t.post.autoPublish,
      approved: AUTO_PUBLISH_STATUSES.includes(t.post.status),
      scheduledAt: t.post.scheduledAt.toISOString(),
      publishedAt: t.publishedAt?.toISOString() ?? null,
      nextAttemptAt: t.nextAttemptAt?.toISOString() ?? null,
      attempts: t.attempts,
      permalink: t.permalink,
      lastError: t.lastError,
      account: t.account ? (t.account.username ? `@${t.account.username}` : t.account.name) : null,
      thumb: first ? { url: previewUrl(t.postId, first.id), kind: first.kind === "video" ? "video" : "image" } : null,
      mediaCount: t.post.media.length,
    };
  });
}

/* ───────────────────────── hesap tablosu ───────────────────────── */

export type AccountMatrixRow = {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  visible: boolean;
  coverUrl: string | null;
  accounts: Partial<
    Record<
      SocialPlatformKey,
      {
        label: string;
        status: string;
        lastError: string | null;
        pictureUrl: string | null;
        /** Platformdaki kimlik (Facebook: sayfa id). */
        externalId: string;
        /** Profil / sayfa bağlantısı. */
        href: string | null;
      }
    >
  >;
};

function profileHref(platform: string, externalId: string, username: string | null): string | null {
  if (platform === "instagram") return username ? `https://www.instagram.com/${username}/` : null;
  if (platform === "facebook") return `https://www.facebook.com/${externalId}`;
  return null;
}

export async function loadAccountMatrix(): Promise<AccountMatrixRow[]> {
  const tenants = await prisma.tenant.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      visible: true,
      coverUrl: true,
      socialAccounts: {
        select: {
          platform: true,
          name: true,
          username: true,
          status: true,
          lastError: true,
          pictureUrl: true,
          externalId: true,
        },
      },
    },
    orderBy: [{ visible: "desc" }, { name: "asc" }],
  });
  return tenants.map((t) => ({
    tenantId: t.id,
    tenantName: t.name,
    tenantSlug: t.slug,
    visible: t.visible,
    coverUrl: t.coverUrl,
    accounts: Object.fromEntries(
      t.socialAccounts.map((a) => [
        a.platform,
        {
          label: a.username ? `@${a.username}` : a.name,
          status: a.status,
          lastError: a.lastError,
          pictureUrl: a.pictureUrl,
          externalId: a.externalId,
          href: profileHref(a.platform, a.externalId, a.username),
        },
      ]),
    ),
  }));
}
