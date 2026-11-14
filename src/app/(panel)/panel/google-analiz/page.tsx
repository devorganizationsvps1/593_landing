import { headers } from "next/headers";
import { redirect } from "next/navigation";
import GoogleAnalyzeBoard from "@/components/panel/ads-publish/GoogleAnalyzeBoard";
import { requireAdsPublishPage } from "@/lib/panel/ads-publish/access";
import { loadGoogleAdsAnalyze } from "@/lib/panel/ads-publish/google-analyze";
import { resolvePanelDateRange } from "@/lib/panel/period";

export const dynamic = "force-dynamic";

export default async function GoogleAnalyzePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; start?: string; end?: string }>;
}) {
  const { actor, denied } = await requireAdsPublishPage();
  if (denied === "login") redirect("/login");
  if (denied === "home") redirect("/");
  if (denied || !actor) redirect("/brands");

  const h = await headers();
  if (h.get("x-panel-mode") !== "staff") {
    redirect("/login?error=AccessDenied");
  }

  const range = await resolvePanelDateRange(await searchParams);
  const snapshot = await loadGoogleAdsAnalyze({
    startDate: range.startDate,
    endDate: range.endDate,
  });

  return <GoogleAnalyzeBoard snapshot={snapshot} rangeLabel={range.label} />;
}
