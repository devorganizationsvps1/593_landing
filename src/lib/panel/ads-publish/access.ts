/**
 * Meta/Google reklam yayın sistemi — API erişimi (staff) + onay allowlist.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isStaffRole } from "@/lib/panel/host";
import { resolveStaffUserId, requireStaffApi } from "@/lib/panel/staff-auth";
import {
  ADS_PUBLISH_PEOPLE,
  canAccessAdsPublish,
} from "@/lib/panel/ads-publish/access-policy";

export { ADS_PUBLISH_PEOPLE, canAccessAdsPublish };

export type AdsPublishActor = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export async function loadAdsPublishActor(session: {
  user: { id?: string | null; email?: string | null; role?: string | null };
}): Promise<AdsPublishActor | null> {
  const id = await resolveStaffUserId(session);
  const user = id
    ? await prisma.user.findFirst({
        where: { id, role: { in: ["admin", "team"] } },
        select: { id: true, name: true, email: true, role: true },
      })
    : null;
  if (!user) return null;
  // Edit/list: tüm admin/team. Onay allowlist’i assertCanApprovePackage’te.
  return {
    id: user.id,
    name: (user.name ?? "").trim() || user.email,
    email: user.email,
    role: user.role,
  };
}

/** Sayfa: yalnızca ADS_PUBLISH allowlist (şimdilik Muhammet). */
export async function requireAdsPublishPage() {
  const session = await auth();
  if (!session?.user) return { session: null, actor: null, denied: "login" as const };
  if (!isStaffRole(session.user.role)) {
    return { session, actor: null, denied: "home" as const };
  }
  const actor = await loadAdsPublishActor(session);
  if (!actor) return { session, actor: null, denied: "brands" as const };
  if (!canAccessAdsPublish(actor)) {
    return { session, actor: null, denied: "brands" as const };
  }
  return {
    session,
    actor,
    denied: null,
    canApprove: true,
  };
}

export async function requireAdsPublishApi() {
  const { headers } = await import("next/headers");
  const { resolvePanelHost } = await import("@/lib/panel/host");
  const h = await headers();
  const resolved = resolvePanelHost(h.get("host"));
  if (resolved.kind === "tenant") {
    return {
      session: null,
      actor: null,
      error: NextResponse.json(
        { error: "Marka host’undan Meta yayın API’sine erişilemez" },
        { status: 403 },
      ),
    };
  }

  const result = await requireStaffApi();
  if (result.error || !result.session) return { ...result, actor: null };

  // client / viewOnly zaten requireStaffApi’de; ekstra kilit
  if (result.session.user.role === "client") {
    return {
      session: null,
      actor: null,
      error: NextResponse.json(
        { error: "Müşteri rolü Meta yayın API’sine erişemez" },
        { status: 403 },
      ),
    };
  }

  const actor = await loadAdsPublishActor(result.session);
  if (!actor) {
    return {
      session: null,
      actor: null,
      error: NextResponse.json(
        { error: "Meta yayın API’si yalnızca ajans personeline açık" },
        { status: 403 },
      ),
    };
  }
  if (!canAccessAdsPublish(actor)) {
    return {
      session: null,
      actor: null,
      error: NextResponse.json(
        { error: "Meta yayın şimdilik yalnızca allowlist kullanıcısına açık" },
        { status: 403 },
      ),
    };
  }
  return { session: result.session, actor, error: null };
}
