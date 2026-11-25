import { NextResponse } from "next/server";
import { requireAdsPublishApi } from "@/lib/panel/ads-publish/access";
import {
  createCreativeRevertPackage,
  decidePackage,
  getPackageDetail,
  submitForApproval,
  updateDraftPackage,
} from "@/lib/panel/ads-publish/packages";
import { buildApprovalPreview } from "@/lib/panel/ads-publish/approval-preview";
import {
  isEditOnlySafeAction,
  packageActionStartsJob,
} from "@/lib/panel/ads-publish/write-policy";
import type { AdChangePayload } from "@/lib/panel/ads-publish/types";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { actor, error } = await requireAdsPublishApi();
  if (error || !actor) return error;
  const { id } = await ctx.params;
  const url = new URL(request.url);
  if (url.searchParams.get("preview") === "1") {
    const preview = await buildApprovalPreview(id);
    if (!preview) {
      return NextResponse.json({ error: "Paket bulunamadı" }, { status: 404 });
    }
    return NextResponse.json({ preview });
  }
  const detail = await getPackageDetail(id);
  if (!detail) {
    return NextResponse.json({ error: "Paket bulunamadı" }, { status: 404 });
  }
  return NextResponse.json(detail);
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { actor, error } = await requireAdsPublishApi();
  if (error || !actor) return error;
  const { id } = await ctx.params;

  let body: {
    action?: string;
    note?: string;
    title?: string;
    payload?: AdChangePayload;
    previewFingerprint?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "JSON gerekli" }, { status: 400 });
  }

  const action = body.action?.trim() ?? "";

  try {
    if (action === "save") {
      if (!body.payload) {
        return NextResponse.json({ error: "payload gerekli" }, { status: 400 });
      }
      // Edit-only güvenli: job başlatmaz.
      if (packageActionStartsJob(action)) {
        return NextResponse.json({ error: "Geçersiz işlem" }, { status: 400 });
      }
      const pack = await updateDraftPackage({
        actor,
        packageId: id,
        title: body.title,
        payload: body.payload,
      });
      return NextResponse.json({ ok: true, package: pack });
    }
    if (action === "submit") {
      if (!isEditOnlySafeAction(action) || packageActionStartsJob(action)) {
        return NextResponse.json({ error: "Geçersiz işlem" }, { status: 400 });
      }
      const pack = await submitForApproval({ actor, packageId: id });
      return NextResponse.json({ ok: true, package: pack });
    }
    if (action === "approve" || action === "reject") {
      const pack = await decidePackage({
        actor,
        packageId: id,
        decision: action,
        note: body.note,
        previewFingerprint: body.previewFingerprint,
      });
      return NextResponse.json({ ok: true, package: pack });
    }
    if (action === "revert_creative") {
      const pack = await createCreativeRevertPackage({
        actor,
        sourcePackageId: id,
      });
      return NextResponse.json({ ok: true, package: pack });
    }
    return NextResponse.json({ error: "Geçersiz işlem" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "İşlem başarısız";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
