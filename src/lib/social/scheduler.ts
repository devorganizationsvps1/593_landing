import { runDuePublishes } from "@/lib/social/publisher";

const INTERVAL_MS = 60_000;

/** Self-host `next start`: dakikada bir zamanı gelen paylaşımlar (SOCIAL_PUBLISH_DISABLED=true kapatır). */
export function startSocialPublishScheduler() {
  const g = globalThis as typeof globalThis & { __593SocialPublish?: boolean };
  if (g.__593SocialPublish) return;
  g.__593SocialPublish = true;
  const tick = () => {
    runDuePublishes().catch((err) => console.error("[social-publish]", err));
  };
  setTimeout(tick, 15_000);
  setInterval(tick, INTERVAL_MS);
}
