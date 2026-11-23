import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import SocialPublishingDashboard from "@/components/panel/SocialPublishingDashboard";
import { isStaffRole } from "@/lib/panel/host";
import { can } from "@/lib/panel/permissions";
import {
  listSocialTargets,
  loadAccountMatrix,
  loadSocialCounts,
  loadSocialHealth,
} from "@/lib/social/overview";

export const dynamic = "force-dynamic";

/** Sosyal medya otomatik paylaşım — sistem durumu, kuyruk, geçmiş, bağlı hesaplar. */
export default async function SocialPublishingPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!isStaffRole(session.user.role)) redirect("/");
  const h = await headers();
  if (h.get("x-panel-mode") !== "staff") redirect("/login?error=AccessDenied");

  const [health, counts, targets, matrix] = await Promise.all([
    loadSocialHealth(),
    loadSocialCounts(),
    listSocialTargets(),
    loadAccountMatrix(),
  ]);

  return (
    <SocialPublishingDashboard
      health={health}
      counts={counts}
      targets={targets}
      matrix={matrix}
      canEdit={can(session.user.role, "brands.edit")}
    />
  );
}
