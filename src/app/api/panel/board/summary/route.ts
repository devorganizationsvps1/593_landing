import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  isCardDueToday,
  isCardLate,
  isDoneColumn,
  isReviewColumn,
  type TaskSummary,
} from "@/lib/panel/board-summary";
import { requireStaffApi, resolveStaffUserId } from "@/lib/panel/staff-auth";

export const runtime = "nodejs";

/**
 * GET — üst çubuk görev özeti: bugün teslim / onay bekleyen / geciken.
 * Admin tüm panoyu, ekip üyesi yalnızca kendine atananları görür.
 */
export async function GET() {
  const { session, error } = await requireStaffApi();
  if (error || !session) return error;

  const userId = await resolveStaffUserId(session);
  const scope: TaskSummary["scope"] =
    session.user.role === "admin" || !userId ? "all" : "mine";

  const cards = await prisma.boardCard.findMany({
    where: scope === "mine" ? { assignees: { some: { userId: userId! } } } : {},
    select: { dueAt: true, column: { select: { name: true } } },
  });

  const now = new Date();
  const summary: TaskSummary = { scope, userId, dueToday: 0, review: 0, overdue: 0 };
  for (const c of cards) {
    const columnName = c.column.name;
    if (isDoneColumn(columnName)) continue;
    if (isReviewColumn(columnName)) summary.review++;
    if (isCardDueToday({ dueAt: c.dueAt, columnName, now })) summary.dueToday++;
    else if (isCardLate({ dueAt: c.dueAt, columnName, now })) summary.overdue++;
  }

  return NextResponse.json(summary, {
    headers: { "Cache-Control": "no-store" },
  });
}
