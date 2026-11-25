import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdsPublishPage } from "@/lib/panel/ads-publish/access";
import { listOrphanCreatives } from "@/lib/panel/ads-publish/orphan-creatives";
import OrphanCreativesBoard from "@/components/panel/ads-publish/OrphanCreativesBoard";

export const dynamic = "force-dynamic";

export default async function MetaOrphanCreativesPage() {
  const { actor, denied } = await requireAdsPublishPage();
  if (denied === "login") redirect("/login");
  if (denied === "home") redirect("/");
  if (denied || !actor) redirect("/brands");

  const h = await headers();
  if (h.get("x-panel-mode") !== "staff") {
    redirect("/login?error=AccessDenied");
  }

  const rows = await listOrphanCreatives({ take: 200 });
  return (
    <OrphanCreativesBoard
      actorName={actor.name}
      initial={rows.map((r) => ({
        id: r.id,
        tenantSlug: r.tenant.slug,
        tenantName: r.tenant.name,
        adAccountId: r.adAccountId,
        creativeId: r.creativeId,
        adId: r.adId,
        packageId: r.packageId,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
      }))}
    />
  );
}
