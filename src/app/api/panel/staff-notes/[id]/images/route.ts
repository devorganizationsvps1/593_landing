import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  BOARD_IMAGE_MAX_BYTES,
  BOARD_IMAGE_MAX_PER_CARD,
  BOARD_IMAGE_TYPES,
  deleteBoardImageFiles,
  saveBoardImage,
} from "@/lib/panel/board-images";
import { requireStaffApi, resolveStaffUserId } from "@/lib/panel/staff-auth";
import {
  canTouchStaffNote,
  serializeStaffNote,
  staffNoteSelect,
} from "@/lib/panel/staff-notes";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

function isUploadBlob(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as File).arrayBuffer === "function" &&
    typeof (value as File).size === "number"
  );
}

async function loadForUser(id: string, userId: string | null) {
  const note = await prisma.staffNote.findUnique({
    where: { id },
    select: { id: true, private: true, authorId: true, images: true },
  });
  if (!note || !canTouchStaffNote(note, userId)) return null;
  return note;
}

async function noteResponse(id: string) {
  const note = await prisma.staffNote.findUnique({ where: { id }, select: staffNoteSelect });
  return NextResponse.json({ note: note ? serializeStaffNote(note) : null });
}

/** POST — nota referans görseli ekle (multipart `file`). */
export async function POST(request: Request, ctx: Ctx) {
  const { session, error } = await requireStaffApi();
  if (error || !session) return error;
  const { id } = await ctx.params;
  const userId = await resolveStaffUserId(session);
  const existing = await loadForUser(id, userId);
  if (!existing) return NextResponse.json({ error: "Not bulunamadı" }, { status: 404 });
  if (existing.images.length >= BOARD_IMAGE_MAX_PER_CARD) {
    return NextResponse.json(
      { error: `Bir nota en fazla ${BOARD_IMAGE_MAX_PER_CARD} görsel eklenebilir` },
      { status: 400 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Form verisi gerekli" }, { status: 400 });
  }
  const file = form.get("file");
  if (!isUploadBlob(file) || file.size === 0) {
    return NextResponse.json({ error: "Görsel seçin" }, { status: 400 });
  }
  if (file.size > BOARD_IMAGE_MAX_BYTES) {
    return NextResponse.json({ error: "Dosya en fazla 8 MB olabilir" }, { status: 400 });
  }
  if (file.type && !BOARD_IMAGE_TYPES.has(file.type)) {
    return NextResponse.json({ error: "JPG, PNG, WebP veya GIF yükleyin" }, { status: 400 });
  }

  let url: string;
  try {
    url = await saveBoardImage(id, Buffer.from(await file.arrayBuffer()));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Görsel işlenemedi: ${message}` }, { status: 400 });
  }

  await prisma.staffNote.update({ where: { id }, data: { images: { push: url } } });
  return noteResponse(id);
}

/** DELETE ?url=… — görseli kaldır. */
export async function DELETE(request: Request, ctx: Ctx) {
  const { session, error } = await requireStaffApi();
  if (error || !session) return error;
  const { id } = await ctx.params;
  const userId = await resolveStaffUserId(session);
  const existing = await loadForUser(id, userId);
  if (!existing) return NextResponse.json({ error: "Not bulunamadı" }, { status: 404 });

  const url = new URL(request.url).searchParams.get("url") ?? "";
  if (!existing.images.includes(url)) {
    return NextResponse.json({ error: "Görsel bulunamadı" }, { status: 404 });
  }
  await prisma.staffNote.update({
    where: { id },
    data: { images: existing.images.filter((u) => u !== url) },
  });
  await deleteBoardImageFiles([url]);
  return noteResponse(id);
}
