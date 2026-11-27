import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermissionApi } from "@/lib/panel/staff-auth";
import {
  isValidMediaKey,
  readMedia,
  storeThumbnail,
  THUMBNAIL_UPLOAD_MAX_BYTES,
  thumbnailPreviewUrl,
} from "@/lib/social/media";
import { ACCEPTED_IMAGE_TYPES } from "@/lib/social/formats";
import { s3Enabled, s3SignedGetUrl, S3_SIGNED_URL_TTL } from "@/lib/storage/s3";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST (multipart, `file`) — YouTube kapak görseli yükler: JPEG'e çevrilir,
 * { key, url } döner. Hedefe bağlanması paylaşım ayarları (PUT publish) ile olur.
 */
export async function POST(request: Request, ctx: Ctx) {
  const { error } = await requirePermissionApi("brands.edit");
  if (error) return error;
  const { id } = await ctx.params;
  const post = await prisma.contentPost.findUnique({ where: { id }, select: { id: true } });
  if (!post) return NextResponse.json({ error: "İçerik bulunamadı" }, { status: 404 });

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return NextResponse.json({ error: "Dosya gerekli" }, { status: 400 });
  }
  if (!(file instanceof File)) return NextResponse.json({ error: "Dosya gerekli" }, { status: 400 });
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Kapak JPG, PNG veya WebP olmalı" }, { status: 400 });
  }
  if (file.size > THUMBNAIL_UPLOAD_MAX_BYTES) {
    return NextResponse.json({ error: "Kapak dosyası en fazla 10 MB olabilir" }, { status: 400 });
  }
  try {
    const { key } = await storeThumbnail(id, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ key, url: thumbnailPreviewUrl(id, key) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Kapak yüklenemedi" }, { status: 400 });
  }
}

/** GET ?key= — panel önizlemesi. */
export async function GET(request: Request, ctx: Ctx) {
  const { error } = await requirePermissionApi("brands.edit");
  if (error) return error;
  const { id } = await ctx.params;
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!isValidMediaKey(key, id)) return new NextResponse("Not found", { status: 404 });
  if (s3Enabled()) {
    return NextResponse.redirect(await s3SignedGetUrl(key), {
      status: 302,
      headers: { "Cache-Control": `private, max-age=${S3_SIGNED_URL_TTL - 60}` },
    });
  }
  const buf = await readMedia(key);
  if (!buf) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(buf), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" },
  });
}
