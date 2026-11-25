import { NextResponse } from "next/server";
import { requireAdsPublishApi } from "@/lib/panel/ads-publish/access";
import { assertCanEditTenant } from "@/lib/panel/ads-publish/authz";
import { prisma } from "@/lib/db";
import { fetchLiveAdCreative } from "@/lib/integrations/meta/write";
import {
  creativeFingerprint,
  detectDefaultMode,
  snapshotFromLiveCreative,
  UnsupportedCreativeShapeError,
  verdictFromSnapshot,
} from "@/lib/panel/ads-publish/creative-edit";
import { CREATIVE_SHAPE_LABEL } from "@/lib/panel/ads-publish/creative-shape";

export const runtime = "nodejs";

/**
 * Canlı kreatif özeti — geniş okuma + şekil sınıflandırıcı.
 * GET ?tenantId=&adId=
 */
export async function GET(request: Request) {
  const { actor, error } = await requireAdsPublishApi();
  if (error || !actor) return error;

  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId")?.trim() ?? "";
  const adId = url.searchParams.get("adId")?.trim() ?? "";
  if (!tenantId || !adId) {
    return NextResponse.json(
      { error: "tenantId ve adId gerekli" },
      { status: 400 },
    );
  }

  try {
    await assertCanEditTenant(actor, tenantId);
    const ad = await prisma.metaAd.findFirst({
      where: { tenantId, adId },
      select: { adId: true, creativeId: true },
    });
    if (!ad) {
      return NextResponse.json(
        { error: "Reklam bu markada bulunamadı" },
        { status: 404 },
      );
    }

    const { creative } = await fetchLiveAdCreative(adId);
    const snapshot = snapshotFromLiveCreative(creative);
    const verdict = verdictFromSnapshot(snapshot);

    let defaultMode: string | null = null;
    let modeError: string | null = null;
    try {
      defaultMode = detectDefaultMode(snapshot);
    } catch (err) {
      modeError =
        err instanceof UnsupportedCreativeShapeError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
    }

    return NextResponse.json({
      ok: verdict.k2aEditable,
      creativeId: creative.id,
      fingerprint: creativeFingerprint(snapshot),
      defaultMode,
      shape: verdict.shape,
      shapeLabel: CREATIVE_SHAPE_LABEL[verdict.shape],
      k2aEditable: verdict.k2aEditable,
      lockReason: verdict.lockReason || modeError,
      code: verdict.code,
      snapshot,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Kreatif okunamadı";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
