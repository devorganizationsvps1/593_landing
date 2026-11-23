import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermissionApi } from "@/lib/panel/staff-auth";
import { MAX_MEDIA_PER_POST } from "@/lib/social/formats";
import { createUploadTarget, maxBytesFor, mediaKind } from "@/lib/social/media";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** POST — yükleme adresi al: { mime, size } → { key, uploadUrl }. */
export async function POST(request: Request, ctx: Ctx) {
  const { error } = await requirePermissionApi("brands.edit");
  if (error) return error;
  const { id } = await ctx.params;
  const post = await prisma.contentPost.findUnique({
    where: { id },
    select: { id: true, _count: { select: { media: true } } },
  });
  if (!post) return NextResponse.json({ error: "İçerik bulunamadı" }, { status: 404 });
  if (post._count.media >= MAX_MEDIA_PER_POST) {
    return NextResponse.json({ error: `En fazla ${MAX_MEDIA_PER_POST} dosya` }, { status: 400 });
  }

  let body: { mime?: string; size?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON gerekli" }, { status: 400 });
  }
  const mime = String(body.mime ?? "");
  const kind = mediaKind(mime);
  if (!kind) {
    return NextResponse.json({ error: "Yalnızca JPG, PNG, WebP, MP4 veya MOV yüklenebilir" }, { status: 400 });
  }
  const size = Number(body.size ?? 0);
  if (!Number.isFinite(size) || size <= 0 || size > maxBytesFor(kind)) {
    const mb = Math.round(maxBytesFor(kind) / 1024 / 1024);
    return NextResponse.json({ error: `Dosya en fazla ${mb} MB olabilir` }, { status: 400 });
  }
  return NextResponse.json(await createUploadTarget({ postId: id, mime }));
}

/** PATCH — sıralama: { order: mediaId[] }. */
export async function PATCH(request: Request, ctx: Ctx) {
  const { error } = await requirePermissionApi("brands.edit");
  if (error) return error;
  const { id } = await ctx.params;
  let body: { order?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON gerekli" }, { status: 400 });
  }
  const order = (body.order ?? []).map(String);
  await prisma.$transaction(
    order.map((mediaId, position) =>
      prisma.contentMedia.updateMany({ where: { id: mediaId, postId: id }, data: { position } }),
    ),
  );
  return NextResponse.json({ ok: true });
}
