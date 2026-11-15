import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import ServerDashboard from "@/components/panel/servers/ServerDashboard";
import { isStaffRole } from "@/lib/panel/host";
import { can } from "@/lib/panel/permissions";
import { loadServerPage } from "@/lib/servers/queries";

export const dynamic = "force-dynamic";

/** Sunucu yönetimi — yalnızca admin. */
export default async function ServersPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; range?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!isStaffRole(session.user.role)) redirect("/");

  const h = await headers();
  if (h.get("x-panel-mode") !== "staff") {
    redirect("/login?error=AccessDenied");
  }
  if (!can(session.user.role, "servers.manage")) redirect("/brands");

  const sp = await searchParams;
  const data = await loadServerPage({ key: sp.s, range: sp.range });
  return <ServerDashboard data={data} />;
}
