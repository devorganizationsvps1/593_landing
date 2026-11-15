import { NextResponse } from "next/server";
import { collectAll } from "@/lib/servers/monitor";

export const runtime = "nodejs";
export const maxDuration = 300;

function cronSecret(): string | null {
  return (
    process.env.CRON_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    null
  );
}

function authorize(request: Request): boolean {
  const expected = cronSecret();
  if (!expected) return false;
  const header = request.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const alt = request.headers.get("x-cron-secret")?.trim() || "";
  return bearer === expected || alt === expected;
}

/**
 * Sunucu ölçümü + site/SSL kontrolü + uyarılar. Self-host’ta instrumentation
 * zamanlayıcısı 5 dakikada bir zaten çalıştırır; bu uç dış cron içindir.
 * Authorization: Bearer CRON_SECRET.
 */
async function handle(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await collectAll();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron server-monitor]", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
