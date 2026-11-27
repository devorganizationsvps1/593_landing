import type { SocialPlatformKey } from "@/lib/social/formats";
import type { OAuthProvider } from "@/lib/social/oauth";
import { youtubeOAuth } from "@/lib/social/youtube";

/** OAuth ile marka başına bağlanan platformlar. */
export const OAUTH_PROVIDERS: Partial<Record<SocialPlatformKey, OAuthProvider>> = {
  youtube: youtubeOAuth,
};

export function oauthProvider(platform: string | null | undefined): OAuthProvider | null {
  return (platform && OAUTH_PROVIDERS[platform as SocialPlatformKey]) || null;
}

/** Platform → bağlantı hazır mı (istemci kimliği tanımlı); UI için. */
export function oauthAvailability(): Partial<Record<SocialPlatformKey, { ready: boolean; hint: string | null }>> {
  return Object.fromEntries(
    Object.entries(OAUTH_PROVIDERS).map(([p, prov]) => [
      p,
      { ready: prov!.configured(), hint: prov!.configured() ? null : prov!.configHint },
    ]),
  );
}
