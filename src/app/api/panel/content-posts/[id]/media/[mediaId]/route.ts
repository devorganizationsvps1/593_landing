import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermissionApi, requirePortalViewApi } from "@/lib/panel/staff-auth";
import { deleteMedia, readMedia } from "@/lib/social/media";
import { s3Enabled, s3SignedGetUrl, S3_SIGNED_URL_TTL } from "@/lib/storage/s3";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; mediaId: string }> };

/** GET — panel önizlemesi (S3 → imzalı yönlendirme). */
export async function GET(_request: Request, ctx: Ctx) {
  const { error } = await requirePortalViewApi();
  if (error) return error;
  const { id, mediaId } = await ctx.params;
  const m = await prisma.contentMedia.findFirst({ where: { id: mediaId, postId: id } });
  if (!m) return new NextResponse("Not found", { status: 404 });
  if (s3Enabled()) {
    return NextResponse.redirect(await s3SignedGetUrl(m.storageKey), {
      status: 302,
      headers: { "Cache-Control": `private, max-age=${S3_SIGNED_URL_TTL - 60}` },
    });
  }
  const buf = await readMedia(m.storageKey);
  if (!buf) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(buf), {
    headers: { "Content-Type": m.mimeType, "Cache-Control": "private, max-age=3600" },
  });
}

/** DELETE — paylaşım sürerken silinemez. */
export async function DELETE(_request: Request, ctx: Ctx) {
  const { error } = await requirePermissionApi("brands.edit");
  if (error) return error;
  const { id, mediaId } = await ctx.params;
  const busy = await prisma.contentPostTarget.count({ where: { postId: id, status: "publishing" } });
  if (busy > 0) {
    return NextResponse.json({ error: "Paylaşım sürerken medya silinemez" }, { status: 409 });
  }
  const m = await prisma.contentMedia.findFirst({ where: { id: mediaId, postId: id } });
  if (!m) return NextResponse.json({ error: "Bulunamadı" }, { status: 404 });
  await prisma.contentMedia.delete({ where: { id: m.id } });
  await deleteMedia(m.storageKey).catch((err) => console.error("[content-media delete]", err));
  return NextResponse.json({ ok: true });
}
