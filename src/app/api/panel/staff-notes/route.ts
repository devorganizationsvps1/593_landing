import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStaffApi, resolveStaffUserId } from "@/lib/panel/staff-auth";
import {
  STAFF_NOTE_BODY_MAX,
  STAFF_NOTE_TITLE_MAX,
  serializeStaffNote,
  staffNoteSelect,
  staffNoteVisibleWhere,
} from "@/lib/panel/staff-notes";

export const runtime = "nodejs";

/** GET — görünür notlar (sabitlenenler önce). */
export async function GET() {
  const { session, error } = await requireStaffApi();
  if (error || !session) return error;
  const userId = await resolveStaffUserId(session);
  const notes = await prisma.staffNote.findMany({
    where: staffNoteVisibleWhere(userId),
    select: staffNoteSelect,
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 500,
  });
  return NextResponse.json({ notes: notes.map(serializeStaffNote) });
}

/** POST — yeni not. Boş not da açılabilir (görsel yapıştırmak için). */
export async function POST(request: Request) {
  const { session, error } = await requireStaffApi();
  if (error || !session) return error;

  let body: { title?: string; body?: string; private?: boolean; pinned?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const title = (body.title ?? "").trim().slice(0, STAFF_NOTE_TITLE_MAX);
  const text = (body.body ?? "").slice(0, STAFF_NOTE_BODY_MAX);
  const authorId = await resolveStaffUserId(session);

  const note = await prisma.staffNote.create({
    data: {
      title,
      body: text,
      // Yazarsız gizli not kimseye görünmez — yazar çözülemezse açık kalsın.
      private: Boolean(body.private) && authorId !== null,
      pinned: Boolean(body.pinned),
      authorId,
    },
    select: staffNoteSelect,
  });
  return NextResponse.json({ note: serializeStaffNote(note) }, { status: 201 });
}
