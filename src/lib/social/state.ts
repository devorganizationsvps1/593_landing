import { prisma } from "@/lib/db";
import type { PublishFormat, SocialPlatformKey } from "@/lib/social/formats";
import { previewUrl } from "@/lib/social/media";

export type SerializedSocialAccount = {
  id: string;
  platform: SocialPlatformKey;
  externalId: string;
  name: string;
  username: string | null;
  pictureUrl: string | null;
  status: string;
  lastError: string | null;
};

export type SerializedMedia = {
  id: string;
  kind: "image" | "video";
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  originalName: string;
  url: string;
};

export type SerializedTarget = {
  id: string;
  platform: SocialPlatformKey;
  format: PublishFormat;
  captionOverride: string | null;
  title: string | null;
  privacy: string | null;
  status: "pending" | "publishing" | "published" | "failed";
  attempts: number;
  nextAttemptAt: string | null;
  permalink: string | null;
  lastError: string | null;
  publishedAt: string | null;
};

export type PublishState = {
  postId: string;
  autoPublish: boolean;
  /** İçeriğin kendisi (Paylaşımlar penceresi düzenleme için). */
  post: {
    tenantId: string;
    tenantName: string;
    tenantSlug: string;
    title: string;
    caption: string;
    scheduledAt: string;
    status: string;
    platforms: string[];
  };
  accounts: SerializedSocialAccount[];
  media: SerializedMedia[];
  targets: SerializedTarget[];
};

export function serializeAccount(a: {
  id: string;
  platform: string;
  externalId: string;
  name: string;
  username: string | null;
  pictureUrl: string | null;
  status: string;
  lastError: string | null;
}): SerializedSocialAccount {
  return {
    id: a.id,
    platform: a.platform as SocialPlatformKey,
    externalId: a.externalId,
    name: a.name,
    username: a.username,
    pictureUrl: a.pictureUrl,
    status: a.status,
    lastError: a.lastError,
  };
}

export async function loadPublishState(postId: string): Promise<PublishState | null> {
  const post = await prisma.contentPost.findUnique({
    where: { id: postId },
    select: {
      id: true,
      autoPublish: true,
      title: true,
      caption: true,
      scheduledAt: true,
      status: true,
      platform: true,
      platforms: true,
      tenant: { select: { id: true, name: true, slug: true, socialAccounts: { orderBy: { platform: "asc" } } } },
      media: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
      targets: { orderBy: { platform: "asc" } },
    },
  });
  if (!post) return null;
  return {
    postId: post.id,
    autoPublish: post.autoPublish,
    post: {
      tenantId: post.tenant.id,
      tenantName: post.tenant.name,
      tenantSlug: post.tenant.slug,
      title: post.title,
      caption: post.caption,
      scheduledAt: post.scheduledAt.toISOString(),
      status: post.status,
      platforms: post.platforms.length ? post.platforms : [post.platform],
    },
    accounts: post.tenant.socialAccounts.map(serializeAccount),
    media: post.media.map((m) => ({
      id: m.id,
      kind: m.kind === "video" ? "video" : "image",
      mimeType: m.mimeType,
      sizeBytes: m.sizeBytes,
      width: m.width,
      height: m.height,
      durationSec: m.durationSec,
      originalName: m.originalName,
      url: previewUrl(post.id, m.id),
    })),
    targets: post.targets.map((t) => ({
      id: t.id,
      platform: t.platform as SocialPlatformKey,
      format: t.format as PublishFormat,
      captionOverride: t.captionOverride,
      title: t.title,
      privacy: t.privacy,
      status: t.status,
      attempts: t.attempts,
      nextAttemptAt: t.nextAttemptAt?.toISOString() ?? null,
      permalink: t.permalink,
      lastError: t.lastError,
      publishedAt: t.publishedAt?.toISOString() ?? null,
    })),
  };
}
