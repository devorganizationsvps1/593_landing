import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isLocalMediaKey, readMedia, verifyPublicGet } from "@/lib/social/media";

export const runtime = "nodejs";

/**
 * Herkese açık, süreli + HMAC imzalı medya — yalnızca S3 yokken; Meta / TikTok
 * dosyayı buradan indirir. S3 varken platformlara doğrudan imzalı S3 URL verilir.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  if (
    !isLocalMediaKey(key) ||
    !verifyPublicGet(key, url.searchParams.get("exp") ?? "", url.searchParams.get("sig") ?? "")
  ) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const m = await prisma.contentMedia.findUnique({ where: { storageKey: key }, select: { mimeType: true } });
  const buf = m ? await readMedia(key) : null;
  if (!m || !buf) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(buf), {
    headers: { "Content-Type": m.mimeType, "Content-Length": String(buf.length) },
  });
}
