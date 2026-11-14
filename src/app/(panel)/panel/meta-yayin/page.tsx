import { headers } from "next/headers";
import { redirect } from "next/navigation";
import MetaPublishBoard from "@/components/panel/ads-publish/MetaPublishBoard";
import { requireAdsPublishPage } from "@/lib/panel/ads-publish/access";
import { listMetaPublishBrands } from "@/lib/panel/ads-publish/google-analyze";
import { listAdChangePackages } from "@/lib/panel/ads-publish/packages";

export const dynamic = "force-dynamic";

export default async function MetaPublishPage() {
  const { actor, denied } = await requireAdsPublishPage();
  if (denied === "login") redirect("/login");
  if (denied === "home") redirect("/");
  if (denied || !actor) redirect("/brands");

  const h = await headers();
  if (h.get("x-panel-mode") !== "staff") {
    redirect("/login?error=AccessDenied");
  }

  const [brands, packages] = await Promise.all([
    listMetaPublishBrands(),
    listAdChangePackages({ platform: "meta" }),
  ]);

  return (
    <MetaPublishBoard
      actorName={actor.name}
      brands={brands}
      packages={packages}
    />
  );
}
