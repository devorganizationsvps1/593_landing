import type { Prisma } from "@prisma/client";

export const STAFF_NOTE_TITLE_MAX = 200;
export const STAFF_NOTE_BODY_MAX = 20_000;

export const staffNoteSelect = {
  id: true,
  title: true,
  body: true,
  images: true,
  pinned: true,
  private: true,
  authorId: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, name: true, email: true, avatarUrl: true } },
} as const satisfies Prisma.StaffNoteSelect;

type StaffNoteRow = Prisma.StaffNoteGetPayload<{ select: typeof staffNoteSelect }>;

export type SerializedStaffNote = Omit<StaffNoteRow, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

export function serializeStaffNote(n: StaffNoteRow): SerializedStaffNote {
  return {
    ...n,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

/** Görünürlük: herkese açık notlar + kişinin kendi gizli notları. */
export function staffNoteVisibleWhere(userId: string | null): Prisma.StaffNoteWhereInput {
  return userId
    ? { OR: [{ private: false }, { authorId: userId }] }
    : { private: false };
}

/** Herkese açık notu her staff düzenler; gizli notu yalnızca yazarı. */
export function canTouchStaffNote(
  note: { private: boolean; authorId: string | null },
  userId: string | null,
): boolean {
  return !note.private || (userId !== null && note.authorId === userId);
}
