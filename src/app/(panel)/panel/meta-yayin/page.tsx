import { headers } from "next/headers";
import { redirect } from "next/navigation";
import MetaPublishBoard from "@/components/panel/ads-publish/MetaPublishBoard";
import { requireAdsPublishPage } from "@/lib/panel/ads-publish/access";
import { listBrandCreativeTasks } from "@/lib/panel/ads-publish/brand-creatives";
import { listMetaPublishBrands } from "@/lib/panel/ads-publish/google-analyze";
import { loadMetaAdsTree } from "@/lib/panel/ads-publish/meta-account-ads";
import { listAdChangePackages } from "@/lib/panel/ads-publish/packages";

export const dynamic = "force-dynamic";

export default async function MetaPublishPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; card?: string }>;
}) {
  const { actor, denied } = await requireAdsPublishPage();
  if (denied === "login") redirect("/login");
  if (denied === "home") redirect("/");
  if (denied || !actor) redirect("/brands");

  const h = await headers();
  if (h.get("x-panel-mode") !== "staff") {
    redirect("/login?error=AccessDenied");
  }

  const sp = await searchParams;
  const [brands, packages, creatives] = await Promise.all([
    listMetaPublishBrands(),
    listAdChangePackages({ platform: "meta" }),
    // BoardCard tabanlı (CreativeAsset şeması gerekmez)
    listBrandCreativeTasks({ take: 60 }),
  ]);

  const initialBrandId =
    brands.find((b) => b.slug === sp.brand || b.id === sp.brand)?.id ??
    brands[0]?.id ??
    "";

  const adsByTenant: Record<
    string,
    Awaited<ReturnType<typeof loadMetaAdsTree>>
  > = {};
  if (initialBrandId) {
    adsByTenant[initialBrandId] = await loadMetaAdsTree(initialBrandId);
  }

  return (
    <MetaPublishBoard
      actorName={actor.name}
      brands={brands}
      packages={packages}
      creatives={creatives}
      adsByTenant={adsByTenant}
      initialBrandId={initialBrandId}
      initialCardId={sp.card ?? null}
    />
  );
}
