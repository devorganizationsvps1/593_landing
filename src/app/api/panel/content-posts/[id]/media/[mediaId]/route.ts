import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { isStaffRole } from "@/lib/panel/host";
import { requirePermissionApi } from "@/lib/panel/staff-auth";
import { deleteMedia, readMedia } from "@/lib/social/media";
import { s3Enabled, s3SignedGetUrl, S3_SIGNED_URL_TTL } from "@/lib/storage/s3";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; mediaId: string }> };

/** GET — panel önizlemesi (S3 → imzalı yönlendirme). */
export async function GET(_request: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });
  const { id, mediaId } = await ctx.params;
  const m = await prisma.contentMedia.findFirst({
    where: { id: mediaId, postId: id },
    include: { post: { select: { tenantId: true, tenant: { select: { slug: true } } } } },
  });
  // Ajans (staff / görüntüleyici) her içeriği; marka üyesi yalnızca kendi markasınınkini görür.
  const staff = isStaffRole(session.user.role) || session.user.viewOnly;
  if (!staff) {
    const ids = session.user.tenantIds;
    const member =
      m != null &&
      (ids.includes(m.post.tenantId) ||
        // Oturum eski tenant id tutuyorsa slug ile doğrula (layout ile aynı kural).
        (ids.length > 0 &&
          Boolean(
            await prisma.tenant.findFirst({
              where: { id: { in: ids }, slug: m.post.tenant.slug },
              select: { id: true },
            }),
          )));
    // Başka markanın medyası için varlık bilgisi sızdırma → 404.
    if (!member) return new NextResponse("Not found", { status: 404 });
  }
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
