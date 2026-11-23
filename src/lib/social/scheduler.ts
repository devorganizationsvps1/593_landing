import { recordSchedulerRun } from "@/lib/social/overview";
import { runDuePublishes } from "@/lib/social/publisher";

const INTERVAL_MS = 60_000;

/** Self-host `next start`: dakikada bir zamanı gelen paylaşımlar (SOCIAL_PUBLISH_DISABLED=true kapatır). */
export function startSocialPublishScheduler() {
  const g = globalThis as typeof globalThis & { __593SocialPublish?: boolean };
  if (g.__593SocialPublish) return;
  g.__593SocialPublish = true;
  const tick = async () => {
    let claimed = 0;
    let error: string | null = null;
    try {
      claimed = (await runDuePublishes()).claimed;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      console.error("[social-publish]", err);
    }
    // /paylasimlar sağlık kartı: zamanlayıcının son çalışması.
    await recordSchedulerRun({ claimed, error }).catch((err) =>
      console.error("[social-publish] kayıt", err),
    );
  };
  setTimeout(() => void tick(), 15_000);
  setInterval(() => void tick(), INTERVAL_MS);
}
