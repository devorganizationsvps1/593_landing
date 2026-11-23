import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import StaffNotesBoard from "@/components/panel/StaffNotesBoard";
import { prisma } from "@/lib/db";
import { isStaffRole } from "@/lib/panel/host";
import { resolveStaffUserId } from "@/lib/panel/staff-auth";
import {
  serializeStaffNote,
  staffNoteSelect,
  staffNoteVisibleWhere,
} from "@/lib/panel/staff-notes";

/** Genel notlar / referans defteri — yalnızca ajans portalı. */
export default async function StaffNotesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!isStaffRole(session.user.role)) redirect("/");

  const h = await headers();
  if (h.get("x-panel-mode") !== "staff") {
    redirect("/login?error=AccessDenied");
  }

  const userId = await resolveStaffUserId(session);
  const notes = await prisma.staffNote.findMany({
    where: staffNoteVisibleWhere(userId),
    select: staffNoteSelect,
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 500,
  });

  return (
    <StaffNotesBoard initial={notes.map(serializeStaffNote)} currentUserId={userId} />
  );
}
