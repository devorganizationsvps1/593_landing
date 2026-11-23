import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import ClientContentCalendar from "@/components/panel/ClientContentCalendar";
import ContentCalendar from "@/components/panel/ContentCalendar";
import { prisma } from "@/lib/db";
import { istanbulDayKey, listClientCalendarPosts } from "@/lib/panel/client-calendar";
import { resolvePanelTenant } from "@/lib/panel/data";
import { listContentPosts } from "@/lib/panel/content-posts";
import { isStaffRole } from "@/lib/panel/host";
import { can } from "@/lib/panel/permissions";

function monthBounds(month: string): { from: Date; to: Date } {
  const [y, m] = month.split("-").map(Number);
  // Takvim ızgarası komşu ayların günlerini de gösterir → ±7 gün pay.
  const from = new Date(Date.UTC(y!, m! - 1, 1) - 7 * 86_400_000);
  const to = new Date(Date.UTC(y!, m!, 0) + 8 * 86_400_000);
  return { from, to };
}

function currentMonth(): string {
  return istanbulDayKey(new Date()).slice(0, 7);
}

/**
 * Sosyal medya içerik takvimi. Ajans portalında tüm markalar (düzenlenebilir),
 * marka panelinde yalnızca o markanın içerikleri (salt okunur).
 */
export default async function ContentCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; tenant?: string; post?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const h = await headers();
  const sp = await searchParams;

  // Marka paneli: yalnızca o markanın takvimi, salt okunur.
  // (Üyelik kontrolü layout'ta; burada tenant her zaman host'tan gelir, URL'den değil.)
  if (h.get("x-panel-mode") === "tenant") {
    const slug = h.get("x-tenant-slug");
    const tenant = slug ? await resolvePanelTenant(slug) : null;
    if (!tenant) notFound();
    const month = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : currentMonth();
    const { from, to } = monthBounds(month);
    const posts = await listClientCalendarPosts({ tenantId: tenant.id, from, to });
    return (
      <ClientContentCalendar
        month={month}
        today={istanbulDayKey(new Date())}
        posts={posts}
      />
    );
  }

  if (!isStaffRole(session.user.role) && !session.user.viewOnly) redirect("/");
  if (h.get("x-panel-mode") !== "staff") redirect("/login?error=AccessDenied");

  // /paylasimlar → ?post=<id>: içeriğin ayını aç ve detayını göster.
  const linkedPost = sp.post
    ? await prisma.contentPost.findUnique({ where: { id: sp.post }, select: { id: true, scheduledAt: true } })
    : null;
  // Sunucu UTC çalışabilir; ay başında gece yanlış ay açılmasın diye İstanbul saatine göre.
  const month =
    sp.month && /^\d{4}-\d{2}$/.test(sp.month)
      ? sp.month
      : linkedPost
        ? new Intl.DateTimeFormat("en-CA", {
            timeZone: "Europe/Istanbul",
            year: "numeric",
            month: "2-digit",
          }).format(linkedPost.scheduledAt)
        : new Intl.DateTimeFormat("en-CA", {
          timeZone: "Europe/Istanbul",
          year: "numeric",
          month: "2-digit",
        }).format(new Date());
  const { from, to } = monthBounds(month);

  const [tenants, staff, withContent] = await Promise.all([
    // Pasif (gizli) markalar da listelenir — içerik planı görünürlükten bağımsız.
    prisma.tenant.findMany({
      select: { id: true, name: true, slug: true, visible: true, coverUrl: true },
      orderBy: [{ visible: "desc" }, { name: "asc" }],
    }),
    prisma.user.findMany({
      where: { role: { in: ["admin", "team"] } },
      select: {
        id: true,
        name: true,
        email: true,
        teamMemberships: { select: { team: { select: { slug: true } } } },
      },
      orderBy: [{ name: "asc" }, { email: "asc" }],
    }),
    // Hiç içeriği olmayan markalar kenar çubuğunda gösterilmez.
    prisma.contentPost.groupBy({ by: ["tenantId"] }),
  ]);
  const hasContent = new Set(withContent.map((r) => r.tenantId));
  const initialTenantId = tenants.find((t) => t.slug === sp.tenant)?.id ?? null;
  // Tüm markaların içerikleri gelir; marka seçimi istemcide (kenar çubuğu).
  const posts = await listContentPosts({ from, to });

  return (
    <ContentCalendar
      month={month}
      initialPosts={posts}
      tenants={tenants.map((t) => ({ ...t, hasContent: hasContent.has(t.id) }))}
      staff={staff.map((u) => ({
        id: u.id,
        label: u.name || u.email,
        teams: u.teamMemberships.map((m) => m.team.slug),
      }))}
      initialTenantId={initialTenantId}
      initialPostId={linkedPost?.id ?? null}
      canEdit={can(session.user.role, "brands.edit")}
    />
  );
}
