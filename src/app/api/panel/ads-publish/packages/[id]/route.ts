import { NextResponse } from "next/server";
import { requireAdsPublishApi } from "@/lib/panel/ads-publish/access";
import {
  decidePackage,
  submitForApproval,
} from "@/lib/panel/ads-publish/packages";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { actor, error } = await requireAdsPublishApi();
  if (error || !actor) return error;
  const { id } = await ctx.params;

  let body: { action?: string; note?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "JSON gerekli" }, { status: 400 });
  }

  try {
    if (body.action === "submit") {
      const pack = await submitForApproval({ actor, packageId: id });
      return NextResponse.json({ ok: true, package: pack });
    }
    if (body.action === "approve" || body.action === "reject") {
      const pack = await decidePackage({
        actor,
        packageId: id,
        decision: body.action,
        note: body.note,
      });
      return NextResponse.json({ ok: true, package: pack });
    }
    return NextResponse.json({ error: "Geçersiz işlem" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "İşlem başarısız";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
