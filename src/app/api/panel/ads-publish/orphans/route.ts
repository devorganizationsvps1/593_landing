import { NextResponse } from "next/server";
import { requireAdsPublishApi } from "@/lib/panel/ads-publish/access";
import {
  listOrphanCreatives,
  markOrphanResolved,
} from "@/lib/panel/ads-publish/orphan-creatives";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { actor, error } = await requireAdsPublishApi();
  if (error || !actor) return error;
  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId")?.trim() || undefined;
  const includeResolved = url.searchParams.get("resolved") === "1";
  const rows = await listOrphanCreatives({
    tenantId,
    includeResolved,
    take: 200,
  });
  return NextResponse.json({
    orphans: rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      tenantSlug: r.tenant.slug,
      tenantName: r.tenant.name,
      adAccountId: r.adAccountId,
      creativeId: r.creativeId,
      adId: r.adId,
      packageId: r.packageId,
      reason: r.reason,
      detail: r.detail,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const { actor, error } = await requireAdsPublishApi();
  if (error || !actor) return error;
  let body: { id?: string; action?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "JSON gerekli" }, { status: 400 });
  }
  if (body.action === "resolve" && body.id) {
    await markOrphanResolved(body.id);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Geçersiz işlem" }, { status: 400 });
}
