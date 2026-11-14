import { NextResponse } from "next/server";
import type { AdChangePlatform } from "@prisma/client";
import { requireAdsPublishApi } from "@/lib/panel/ads-publish/access";
import { emptyAdChangePayload } from "@/lib/panel/ads-publish/empty-payload";
import { getIstanbulTodayYmd } from "@/lib/date/now";
import { addDaysYmd } from "@/lib/date/tr";
import {
  createDraftPackage,
  listAdChangePackages,
} from "@/lib/panel/ads-publish/packages";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { actor, error } = await requireAdsPublishApi();
  if (error || !actor) return error;
  const url = new URL(request.url);
  const platform = url.searchParams.get("platform");
  const rows = await listAdChangePackages({
    platform:
      platform === "meta" || platform === "google"
        ? (platform as AdChangePlatform)
        : undefined,
  });
  return NextResponse.json({ packages: rows });
}

export async function POST(request: Request) {
  const { actor, error } = await requireAdsPublishApi();
  if (error || !actor) return error;

  let body: {
    tenantId?: string;
    platform?: string;
    title?: string;
    adAccountId?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "JSON gerekli" }, { status: 400 });
  }

  const tenantId = body.tenantId?.trim() ?? "";
  const platform = body.platform === "google" ? "google" : "meta";
  if (!tenantId) {
    return NextResponse.json({ error: "Marka gerekli" }, { status: 400 });
  }

  const today = await getIstanbulTodayYmd();
  try {
    const pack = await createDraftPackage({
      actor,
      tenantId,
      platform,
      title: body.title ?? "",
      payload: emptyAdChangePayload({
        tenantId,
        platform,
        adAccountId: body.adAccountId?.trim() || "",
        dateStart: addDaysYmd(today, -6),
        dateEnd: today,
      }),
    });
    return NextResponse.json({ ok: true, package: pack });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Kayıt alınamadı";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
