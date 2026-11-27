/**
 * Otomatik paylaşım motoru. Zamanlayıcı (instrumentation, dakikada bir) veya
 * /api/cron/social-publish çağırır; "Şimdi paylaş" aynı yolu kullanır.
 *
 * Her hedef (içerik × platform) atomik olarak `publishing`'e çekilip kilitlenir
 * → birden çok instance / üst üste tick aynı hedefi iki kez paylaşmaz.
 */
import type { ContentPostTarget } from "@prisma/client";
import { prisma } from "@/lib/db";
import { resolveOpenAlertsOfType, upsertOpenAlert } from "@/lib/panel/alerts-engine";
import { AUTO_PUBLISH_STATUSES } from "@/lib/panel/content-posts";
import {
  PUBLISHER_READY,
  SOCIAL_PLATFORM_LABEL,
  UNAPPROVED_NOTE,
  validateTarget,
  type PublishFormat,
  type SocialPlatformKey,
} from "@/lib/social/formats";
import { publishFacebook, publishInstagram } from "@/lib/social/meta";
import { publishYoutube } from "@/lib/social/youtube";
import { PublishError, type Publisher } from "@/lib/social/types";

const PUBLISHERS: Partial<Record<SocialPlatformKey, Publisher>> = {
  instagram: publishInstagram,
  facebook: publishFacebook,
  youtube: publishYoutube,
};

const MAX_ATTEMPTS = 4;
const BACKOFF_MIN = [2, 10, 30];
/** Bu süreden uzun `publishing` kalan hedef çökmüş sayılır ve yeniden alınır. */
const LOCK_STALE_MS = 25 * 60_000;
const CONCURRENCY = 3;

function staleBefore(): Date {
  return new Date(Date.now() - LOCK_STALE_MS);
}

/** Atomik sahiplenme: başka işçi aldıysa false. */
async function claim(t: Pick<ContentPostTarget, "id" | "status" | "updatedAt">): Promise<boolean> {
  const { count } = await prisma.contentPostTarget.updateMany({
    where: {
      id: t.id,
      status: t.status,
      updatedAt: t.updatedAt,
    },
    data: { status: "publishing", lockedAt: new Date(), attempts: { increment: 1 } },
  });
  return count === 1;
}

async function processTarget(targetId: string): Promise<void> {
  const target = await prisma.contentPostTarget.findUnique({
    where: { id: targetId },
    include: {
      post: {
        include: {
          tenant: { select: { id: true, name: true } },
          media: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
        },
      },
    },
  });
  if (!target || target.status !== "publishing") return;
  const platform = target.platform as SocialPlatformKey;
  const label = SOCIAL_PLATFORM_LABEL[platform];
  const caption = (target.captionOverride?.trim() || target.post.caption).trim();

  try {
    const account =
      (target.socialAccountId
        ? await prisma.socialAccount.findUnique({ where: { id: target.socialAccountId } })
        : null) ??
      (await prisma.socialAccount.findUnique({
        where: { tenantId_platform: { tenantId: target.post.tenantId, platform: target.platform } },
      }));
    if (!account) throw new PublishError(`${label} hesabı bu markaya bağlı değil.`);
    const publisher = PUBLISHERS[platform];
    if (!publisher || !PUBLISHER_READY[platform]) {
      throw new PublishError(`${label} otomatik paylaşımı henüz etkin değil.`);
    }
    const problems = validateTarget(
      { platform, format: target.format as PublishFormat, title: target.title },
      target.post.media,
      caption,
    );
    if (problems.length) throw new PublishError(problems.join(" "));

    const result = await publisher({
      target,
      account,
      caption,
      media: target.post.media,
      saveProgress: async (ref) => {
        await prisma.contentPostTarget.update({
          where: { id: target.id },
          data: { progressRef: ref, lockedAt: new Date() },
        });
      },
    });

    await prisma.contentPostTarget.update({
      where: { id: target.id },
      data: {
        status: "published",
        socialAccountId: account.id,
        externalId: result.externalId,
        permalink: result.permalink,
        publishedAt: new Date(),
        lastError: null,
        lockedAt: null,
        nextAttemptAt: null,
        progressRef: null,
      },
    });
    const remaining = await prisma.contentPostTarget.count({
      where: { postId: target.postId, status: { not: "published" } },
    });
    if (remaining === 0) {
      await prisma.contentPost.update({ where: { id: target.postId }, data: { status: "published" } });
    }
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
    const retryable = err instanceof PublishError ? err.retryable : false;
    const canRetry = retryable && target.attempts < MAX_ATTEMPTS;
    const delayMin = BACKOFF_MIN[Math.min(target.attempts - 1, BACKOFF_MIN.length - 1)] ?? 30;
    await prisma.contentPostTarget.update({
      where: { id: target.id },
      data: {
        status: canRetry ? "pending" : "failed",
        lastError: message,
        lockedAt: null,
        nextAttemptAt: canRetry ? new Date(Date.now() + delayMin * 60_000) : null,
      },
    });
    console.error("[social-publish]", JSON.stringify({ targetId: target.id, platform, message, retry: canRetry }));
    if (!canRetry) {
      try {
        await upsertOpenAlert({
          tenantId: target.post.tenantId,
          type: "publish_failed",
          severity: "critical",
          message: `${label} paylaşımı başarısız: ${target.post.title || "içerik"} — ${message}`.slice(0, 500),
          details: { platform: label, postId: target.postId, error: message },
        });
      } catch (alertErr) {
        console.error("[social-publish] alert", alertErr);
      }
    }
  }
}

async function runPool(ids: string[]): Promise<void> {
  let i = 0;
  const worker = async () => {
    while (i < ids.length) {
      const id = ids[i++]!;
      await processTarget(id);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
}

const UNAPPROVED_ALERT = "publish_unapproved";

/**
 * Saati geçmiş ama onaylanmamış içerikler sessizce kaçmasın: hedef bir kez
 * işaretlenir (beklemede kalır) ve markanın ekibine uyarı gider. Onaylanan /
 * ertelenen / silinen içerikler kalmayınca uyarı kendiliğinden kapanır.
 */
async function flagUnapproved(now: Date): Promise<void> {
  const rows = await prisma.contentPostTarget.findMany({
    where: {
      status: "pending",
      lastError: null,
      post: {
        autoPublish: true,
        socialDraftAt: null,
        scheduledAt: { lte: now },
        status: { notIn: [...AUTO_PUBLISH_STATUSES, "published"] },
      },
    },
    select: {
      id: true,
      post: { select: { id: true, title: true, caption: true, tenantId: true } },
    },
    take: 200,
  });
  if (rows.length) {
    await prisma.contentPostTarget.updateMany({
      where: { id: { in: rows.map((r) => r.id) }, lastError: null },
      data: { lastError: UNAPPROVED_NOTE },
    });
    const byTenant = new Map<string, Map<string, string>>();
    for (const r of rows) {
      const posts = byTenant.get(r.post.tenantId) ?? new Map<string, string>();
      posts.set(r.post.id, r.post.title || r.post.caption.replace(/\s+/g, " ").slice(0, 60) || "içerik");
      byTenant.set(r.post.tenantId, posts);
    }
    for (const [tenantId, posts] of byTenant) {
      const titles = [...posts.values()];
      await upsertOpenAlert({
        tenantId,
        type: UNAPPROVED_ALERT,
        severity: "warn",
        message: `${titles.length} içerik onaylanmadığı için saatinde paylaşılmadı: ${titles.join(", ")}`.slice(0, 500),
        details: { count: titles.length, posts: titles },
      });
    }
  }

  const open = await prisma.alert.findMany({
    where: { type: UNAPPROVED_ALERT, resolved: false },
    select: { tenantId: true },
  });
  for (const { tenantId } of open) {
    const still = await prisma.contentPostTarget.count({
      where: {
        status: "pending",
        lastError: UNAPPROVED_NOTE,
        post: { tenantId, socialDraftAt: null, status: { notIn: AUTO_PUBLISH_STATUSES } },
      },
    });
    if (still === 0) await resolveOpenAlertsOfType(tenantId, UNAPPROVED_ALERT, "İçerikler onaylandı ya da kaldırıldı");
  }
}

let running = false;

/** Zamanı gelen tüm hedefler. Aynı süreçte üst üste binmez. */
export async function runDuePublishes(): Promise<{ claimed: number }> {
  if (running) return { claimed: 0 };
  running = true;
  try {
    const now = new Date();
    try {
      await flagUnapproved(now);
    } catch (err) {
      // Uyarı tarafındaki bir hata paylaşımı durdurmasın.
      console.error("[social-publish] onaysız kontrolü", err);
    }
    const due = await prisma.contentPostTarget.findMany({
      where: {
        OR: [
          {
            status: "pending",
            AND: [{ OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }],
            post: {
              autoPublish: true,
              socialDraftAt: null,
              scheduledAt: { lte: now },
              status: { in: AUTO_PUBLISH_STATUSES },
            },
          },
          { status: "publishing", lockedAt: { lt: staleBefore() } },
        ],
      },
      select: { id: true, status: true, updatedAt: true, attempts: true },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    const claimed: string[] = [];
    for (const t of due) {
      if (t.status === "publishing" && t.attempts >= MAX_ATTEMPTS) {
        await prisma.contentPostTarget.updateMany({
          where: { id: t.id, status: "publishing", updatedAt: t.updatedAt },
          data: { status: "failed", lockedAt: null, lastError: "Paylaşım yarıda kaldı; platformda kontrol edip tekrar deneyin." },
        });
        continue;
      }
      if (await claim(t)) claimed.push(t.id);
    }
    if (claimed.length) await runPool(claimed);
    return { claimed: claimed.length };
  } finally {
    running = false;
  }
}

/**
 * "Şimdi paylaş" / "Tekrar dene": içeriğin yayınlanmamış hedeflerini hemen
 * çalıştırır (zaman ve otomatik paylaşım anahtarından bağımsız).
 */
export async function publishPostNow(postId: string, platforms?: SocialPlatformKey[]): Promise<number> {
  const rows = await prisma.contentPostTarget.findMany({
    where: {
      postId,
      status: { in: ["pending", "failed"] },
      ...(platforms?.length ? { platform: { in: platforms } } : {}),
    },
    select: { id: true, status: true, updatedAt: true },
  });
  const claimed: string[] = [];
  for (const t of rows) {
    // Manuel deneme sayacı sıfırdan başlar.
    const reset = await prisma.contentPostTarget.updateMany({
      where: { id: t.id, status: t.status, updatedAt: t.updatedAt },
      data: { status: "publishing", lockedAt: new Date(), attempts: 1, nextAttemptAt: null, lastError: null },
    });
    if (reset.count === 1) claimed.push(t.id);
  }
  if (claimed.length) await runPool(claimed);
  return claimed.length;
}
