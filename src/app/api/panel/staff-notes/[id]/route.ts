import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteBoardImageFiles } from "@/lib/panel/board-images";
import { requireStaffApi, resolveStaffUserId } from "@/lib/panel/staff-auth";
import {
  STAFF_NOTE_BODY_MAX,
  STAFF_NOTE_TITLE_MAX,
  canTouchStaffNote,
  serializeStaffNote,
  staffNoteSelect,
} from "@/lib/panel/staff-notes";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

async function loadForUser(id: string, userId: string | null) {
  const note = await prisma.staffNote.findUnique({
    where: { id },
    select: { id: true, private: true, authorId: true, images: true },
  });
  if (!note || !canTouchStaffNote(note, userId)) return null;
  return note;
}

/** PATCH — başlık / metin / sabitle / gizlilik. */
export async function PATCH(request: Request, ctx: Ctx) {
  const { session, error } = await requireStaffApi();
  if (error || !session) return error;
  const { id } = await ctx.params;
  const userId = await resolveStaffUserId(session);
  const existing = await loadForUser(id, userId);
  if (!existing) return NextResponse.json({ error: "Not bulunamadı" }, { status: 404 });

  let body: { title?: string; body?: string; pinned?: boolean; private?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "JSON gerekli" }, { status: 400 });
  }

  const data: { title?: string; body?: string; pinned?: boolean; private?: boolean } = {};
  if (typeof body.title === "string") data.title = body.title.trim().slice(0, STAFF_NOTE_TITLE_MAX);
  if (typeof body.body === "string") data.body = body.body.slice(0, STAFF_NOTE_BODY_MAX);
  if (typeof body.pinned === "boolean") data.pinned = body.pinned;
  if (typeof body.private === "boolean") {
    // Gizliliği yalnızca yazar değiştirir.
    if (existing.authorId === null || existing.authorId !== userId) {
      return NextResponse.json(
        { error: "Gizliliği yalnızca notu yazan değiştirebilir" },
        { status: 403 },
      );
    }
    data.private = body.private;
  }

  const note = await prisma.staffNote.update({
    where: { id },
    data,
    select: staffNoteSelect,
  });
  return NextResponse.json({ note: serializeStaffNote(note) });
}

/** DELETE — notu ve görsellerini sil. */
export async function DELETE(_request: Request, ctx: Ctx) {
  const { session, error } = await requireStaffApi();
  if (error || !session) return error;
  const { id } = await ctx.params;
  const userId = await resolveStaffUserId(session);
  const existing = await loadForUser(id, userId);
  if (!existing) return NextResponse.json({ error: "Not bulunamadı" }, { status: 404 });

  await prisma.staffNote.delete({ where: { id } });
  await deleteBoardImageFiles(existing.images);
  return NextResponse.json({ ok: true });
}
