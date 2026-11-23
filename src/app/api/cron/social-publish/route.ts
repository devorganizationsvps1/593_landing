import { NextResponse } from "next/server";
import { runDuePublishes } from "@/lib/social/publisher";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorize(request: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim() || process.env.AUTH_SECRET?.trim();
  if (!expected) return false;
  const header = request.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const alt = request.headers.get("x-cron-secret")?.trim() || "";
  return bearer === expected || alt === expected;
}

/**
 * Zamanı gelen sosyal medya paylaşımları. Uygulama içi zamanlayıcı zaten
 * dakikada bir çalışır; bu uç dış cron / elle tetikleme içindir.
 */
async function handle(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const r = await runDuePublishes();
  return NextResponse.json({ ok: true, ...r });
}

export const GET = handle;
export const POST = handle;
