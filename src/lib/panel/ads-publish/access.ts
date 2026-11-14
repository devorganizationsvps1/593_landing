/**
 * Meta/Google reklam yayın sistemi — yalnızca admin rolü
 * ve Hakan, Numan, Muhammet.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isStaffRole } from "@/lib/panel/host";
import { resolveStaffUserId, requireStaffApi } from "@/lib/panel/staff-auth";

export const ADS_PUBLISH_PEOPLE = ["Hakan", "Numan", "Muhammet"] as const;

export type AdsPublishActor = {
  id: string;
  name: string;
  email: string;
  role: string;
};

function normTr(value: string): string {
  return value.trim().toLocaleLowerCase("tr");
}

function firstName(value: string): string {
  return normTr(value).split(/\s+/)[0] ?? "";
}

export function canAccessAdsPublish(
  person: { name?: string | null; email?: string | null; role?: string | null } | null,
): boolean {
  if (!person) return false;
  if (person.role === "admin") return true;
  const name = person.name ?? "";
  const email = person.email ?? "";
  const first = firstName(name);
  const full = normTr(name);
  const local = normTr(email).split("@")[0] ?? "";
  return ADS_PUBLISH_PEOPLE.some((raw) => {
    const n = normTr(raw);
    return first === n || full === n || local.includes(n);
  });
}

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
  const actor: AdsPublishActor = {
    id: user.id,
    name: (user.name ?? "").trim() || user.email,
    email: user.email,
    role: user.role,
  };
  return canAccessAdsPublish(actor) ? actor : null;
}

/** Sayfa: yoksa markalar listesine. */
export async function requireAdsPublishPage() {
  const session = await auth();
  if (!session?.user) return { session: null, actor: null, denied: "login" as const };
  if (!isStaffRole(session.user.role)) {
    return { session, actor: null, denied: "home" as const };
  }
  const actor = await loadAdsPublishActor(session);
  if (!actor) return { session, actor: null, denied: "brands" as const };
  return { session, actor, denied: null };
}

export async function requireAdsPublishApi() {
  const result = await requireStaffApi();
  if (result.error || !result.session) return { ...result, actor: null };
  const actor = await loadAdsPublishActor(result.session);
  if (!actor) {
    return {
      session: null,
      actor: null,
      error: NextResponse.json(
        { error: "Bu sayfa yalnızca admin, Hakan, Numan ve Muhammet için açık" },
        { status: 403 },
      ),
    };
  }
  return { session: result.session, actor, error: null };
}
