/**
 * Otomatik paylaşım: platform → desteklenen formatlar ve medya kuralları.
 * İstemci (takvim formu) ve sunucu (yayın motoru) aynı doğrulamayı kullanır —
 * sunucu-özel import eklemeyin.
 */

export const SOCIAL_PLATFORMS = ["instagram", "facebook", "tiktok", "youtube"] as const;
export type SocialPlatformKey = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_PLATFORM_LABEL: Record<SocialPlatformKey, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
};

/** Yayın motoru bu platformu çalıştırabiliyor mu (diğerleri hesap bağlansa da beklemede). */
export const PUBLISHER_READY: Record<SocialPlatformKey, boolean> = {
  instagram: true,
  facebook: true,
  tiktok: false,
  youtube: true,
};

export type PublishFormat = "post" | "reel" | "story" | "video" | "short" | "photo";

export const FORMAT_LABEL: Record<PublishFormat, string> = {
  post: "Gönderi / Carousel",
  reel: "Reels",
  story: "Hikâye",
  video: "Video",
  short: "Shorts",
  photo: "Fotoğraf (carousel)",
};

export const PLATFORM_FORMATS: Record<SocialPlatformKey, PublishFormat[]> = {
  instagram: ["post", "reel", "story"],
  facebook: ["post", "reel", "story"],
  tiktok: ["video", "photo"],
  youtube: ["video", "short"],
};

export const PRIVACY_OPTIONS: Partial<Record<SocialPlatformKey, { value: string; label: string }[]>> = {
  youtube: [
    { value: "public", label: "Herkese açık" },
    { value: "unlisted", label: "Liste dışı" },
    { value: "private", label: "Gizli" },
  ],
  tiktok: [
    { value: "PUBLIC_TO_EVERYONE", label: "Herkese açık" },
    { value: "MUTUAL_FOLLOW_FRIENDS", label: "Arkadaşlar" },
    { value: "SELF_ONLY", label: "Yalnızca ben" },
  ],
};

export const CAPTION_LIMIT: Record<SocialPlatformKey, number> = {
  instagram: 2200,
  facebook: 63206,
  tiktok: 2200,
  youtube: 5000,
};

export const YOUTUBE_TITLE_LIMIT = 100;

/** Takvim içeriğinden varsayılan YouTube başlığı: içerik başlığı, yoksa metnin ilk satırı. */
export function youtubeTitleFrom(title: string | null | undefined, caption: string | null | undefined): string | null {
  const t = (title?.trim() || caption?.trim().split("\n")[0] || "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, YOUTUBE_TITLE_LIMIT) : null;
}

/** Yükleme sınırları. */
export const MAX_MEDIA_PER_POST = 35;
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/quicktime"];

export function isSocialPlatform(v: unknown): v is SocialPlatformKey {
  return typeof v === "string" && (SOCIAL_PLATFORMS as readonly string[]).includes(v);
}

export function isFormatFor(platform: SocialPlatformKey, v: unknown): v is PublishFormat {
  return typeof v === "string" && (PLATFORM_FORMATS[platform] as string[]).includes(v);
}

export type MediaShape = {
  kind: string;
  width?: number | null;
  height?: number | null;
  durationSec?: number | null;
};

export type TargetShape = {
  platform: SocialPlatformKey;
  format: PublishFormat;
  title?: string | null;
};

/**
 * Hedef + medya uyumlu mu? Sorun varsa Türkçe açıklama listesi döner
 * (boş liste = paylaşılabilir).
 */
export function validateTarget(target: TargetShape, media: MediaShape[], caption: string): string[] {
  const errs: string[] = [];
  const images = media.filter((m) => m.kind === "image").length;
  const videos = media.filter((m) => m.kind === "video").length;
  const total = media.length;
  const label = SOCIAL_PLATFORM_LABEL[target.platform];
  const v = media.find((m) => m.kind === "video");

  // Kural: medya ve açıklama olmadan paylaşım yapılmaz — hikâyenin açıklaması
  // olmaz (platform almıyor), orada yalnızca medya gerekir.
  const story = target.format === "story";
  if (total === 0) errs.push(`${label}: medya olmadan paylaşılamaz.`);
  if (!story && !caption.trim()) errs.push(`${label}: açıklama olmadan paylaşılamaz.`);
  if (!story && caption.length > CAPTION_LIMIT[target.platform]) {
    errs.push(`${label}: metin en fazla ${CAPTION_LIMIT[target.platform]} karakter olabilir.`);
  }

  switch (`${target.platform}:${target.format}`) {
    case "instagram:post":
      if (total > 10) errs.push("Instagram carousel en fazla 10 öğe alır.");
      break;
    case "instagram:reel":
    case "facebook:reel":
      if (videos !== 1 || images > 0) errs.push(`${label} Reels için yalnızca 1 video gerekli.`);
      if (v?.durationSec && v.durationSec > 15 * 60) errs.push(`${label} Reels en fazla 15 dakika olabilir.`);
      break;
    case "instagram:story":
    case "facebook:story":
      if (total > 1) errs.push(`${label} hikâyesi için tek görsel veya video seçin.`);
      break;
    case "facebook:post":
      if (videos > 0 && (videos > 1 || images > 0)) {
        errs.push("Facebook gönderisinde video tek başına olmalı (fotoğrafla karışık olamaz).");
      }
      if (images > 10) errs.push("Facebook gönderisi en fazla 10 fotoğraf alır.");
      break;
    case "tiktok:video":
      if (videos !== 1 || images > 0) errs.push("TikTok videosu için yalnızca 1 video gerekli.");
      break;
    case "tiktok:photo":
      if (images === 0 || videos > 0) errs.push("TikTok fotoğraf gönderisi yalnızca görsel alır.");
      if (images > 35) errs.push("TikTok fotoğraf gönderisi en fazla 35 görsel alır.");
      break;
    case "youtube:video":
    case "youtube:short":
      if (videos !== 1 || images > 0) errs.push("YouTube için yalnızca 1 video gerekli.");
      if (!target.title?.trim()) errs.push("YouTube video başlığı gerekli.");
      if ((target.title?.length ?? 0) > YOUTUBE_TITLE_LIMIT) {
        errs.push(`YouTube başlığı en fazla ${YOUTUBE_TITLE_LIMIT} karakter olabilir.`);
      }
      if (target.format === "short" && v?.durationSec && v.durationSec > 180) {
        errs.push("YouTube Shorts en fazla 3 dakika olabilir.");
      }
      break;
    default:
      errs.push(`${label} için geçersiz format.`);
  }
  return errs;
}

/** Varsayılan format. Instagram / Facebook'ta her zaman gönderi (tekil video gönderisi Instagram'da Reels olarak gider). */
export function defaultFormat(platform: SocialPlatformKey, media: MediaShape[]): PublishFormat {
  const onlyVideo = media.length === 1 && media[0]!.kind === "video";
  const v = media[0];
  const vertical = v?.width && v?.height ? v.height > v.width : false;
  switch (platform) {
    case "instagram":
    case "facebook":
      return "post";
    case "tiktok":
      return media.some((m) => m.kind === "video") ? "video" : "photo";
    case "youtube":
      return onlyVideo && vertical && (v?.durationSec ?? 0) <= 180 ? "short" : "video";
  }
}

/**
 * Saati geçmiş ama onaylanmamış içeriğin hedefine yazılan not. Hedef beklemede
 * kalır; içerik "Onaylandı" yapılınca zamanlayıcı hemen paylaşır.
 */
export const UNAPPROVED_NOTE = "Onaylanmadığı için saatinde paylaşılmadı — onaylanınca hemen paylaşılır.";

export const PUBLISH_STATUS_LABEL: Record<string, string> = {
  pending: "Sırada",
  publishing: "Paylaşılıyor",
  published: "Paylaşıldı",
  failed: "Hata",
};
