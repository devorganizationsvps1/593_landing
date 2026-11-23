import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermissionApi } from "@/lib/panel/staff-auth";
import {
  deleteMedia,
  headMedia,
  isValidMediaKey,
  maxBytesFor,
  mediaKind,
  normalizeImage,
  previewUrl,
} from "@/lib/social/media";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

type Body = {
  key?: string;
  mime?: string;
  name?: string;
  width?: number | null;
  height?: number | null;
  durationSec?: number | null;
};

function posInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** POST — yükleme bitti: dosyayı doğrular, görseli JPEG'e çevirir, kaydı açar. */
export async function POST(request: Request, ctx: Ctx) {
  const { error } = await requirePermissionApi("brands.edit");
  if (error) return error;
  const { id } = await ctx.params;
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON gerekli" }, { status: 400 });
  }
  const key = String(body.key ?? "");
  const mime = String(body.mime ?? "");
  const kind = mediaKind(mime);
  if (!kind || !isValidMediaKey(key, id)) {
    return NextResponse.json({ error: "Geçersiz dosya" }, { status: 400 });
  }
  const post = await prisma.contentPost.findUnique({ where: { id }, select: { id: true } });
  if (!post) {
    await deleteMedia(key).catch(() => {});
    return NextResponse.json({ error: "İçerik bulunamadı" }, { status: 404 });
  }
  const size = await headMedia(key);
  if (size == null) return NextResponse.json({ error: "Dosya yüklenmemiş" }, { status: 400 });
  if (size > maxBytesFor(kind)) {
    await deleteMedia(key).catch(() => {});
    return NextResponse.json({ error: "Dosya çok büyük" }, { status: 400 });
  }

  let final = { key, mime, size, width: posInt(body.width), height: posInt(body.height) };
  if (kind === "image") {
    try {
      final = await normalizeImage(id, key, mime);
    } catch {
      await deleteMedia(key).catch(() => {});
      return NextResponse.json({ error: "Görsel okunamadı" }, { status: 400 });
    }
  }
  const max = await prisma.contentMedia.aggregate({ where: { postId: id }, _max: { position: true } });
  const media = await prisma.contentMedia.create({
    data: {
      postId: id,
      kind,
      storageKey: final.key,
      mimeType: final.mime,
      sizeBytes: final.size,
      width: final.width,
      height: final.height,
      durationSec:
        kind === "video" && Number.isFinite(Number(body.durationSec)) ? Number(body.durationSec) : null,
      position: (max._max.position ?? -1) + 1,
      originalName: String(body.name ?? "").slice(0, 200),
    },
  });
  return NextResponse.json({
    media: {
      id: media.id,
      kind: media.kind,
      mimeType: media.mimeType,
      sizeBytes: media.sizeBytes,
      width: media.width,
      height: media.height,
      durationSec: media.durationSec,
      originalName: media.originalName,
      url: previewUrl(id, media.id),
    },
  });
}
