import type { ContentMedia, ContentPostTarget, SocialAccount } from "@prisma/client";

/**
 * Yayın hatası. `retryable` yalnızca platformun işlemi yapmadığından emin
 * olduğumuz durumlarda true olmalı (rate limit, geçici hata) — aksi halde
 * yeniden deneme aynı içeriği iki kez paylaşabilir.
 */
export class PublishError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "PublishError";
  }
}

export type PublishContext = {
  target: ContentPostTarget;
  account: SocialAccount;
  caption: string;
  /** Sıralı medya. */
  media: ContentMedia[];
  /** Yarım kalan işi (container id vb.) kaydeder; yeniden denemede `target.progressRef` olarak gelir. */
  saveProgress: (ref: string | null) => Promise<void>;
};

export type PublishResult = {
  externalId: string;
  permalink: string | null;
};

export type Publisher = (ctx: PublishContext) => Promise<PublishResult>;
