import { NextResponse } from "next/server";
import { requirePermissionApi } from "@/lib/panel/staff-auth";
import { isValidMediaKey, MAX_LOCAL_UPLOAD_BYTES, verifyLocalUpload, writeLocalMedia } from "@/lib/social/media";
import { s3Enabled } from "@/lib/storage/s3";

export const runtime = "nodejs";

/**
 * PUT — S3 tanımlı değilken (geliştirme) dosya gövdesi buraya yüklenir.
 * Adres `createUploadTarget` ile imzalanır. Canlıda S3 imzalı PUT kullanılır.
 */
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requirePermissionApi("brands.edit");
  if (error) return error;
  if (s3Enabled()) return NextResponse.json({ error: "S3 etkin" }, { status: 400 });
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  if (
    !isValidMediaKey(key, id) ||
    !verifyLocalUpload(key, url.searchParams.get("exp") ?? "", url.searchParams.get("sig") ?? "")
  ) {
    return NextResponse.json({ error: "Geçersiz yükleme adresi" }, { status: 403 });
  }
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > MAX_LOCAL_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Dosya çok büyük" }, { status: 413 });
  }
  const body = Buffer.from(await request.arrayBuffer());
  if (body.length > MAX_LOCAL_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Dosya çok büyük" }, { status: 413 });
  }
  await writeLocalMedia(key, body);
  return NextResponse.json({ ok: true });
}
