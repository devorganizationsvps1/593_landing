import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/panel/audit";
import { requirePermissionApi } from "@/lib/panel/staff-auth";
import { loadInventory } from "@/lib/servers/dokploy";
import { collectAll, runCleanup, setAutoCleanup } from "@/lib/servers/monitor";
import { CLEANUP_ACTIONS, type CleanupAction } from "@/lib/servers/types";

export const runtime = "nodejs";
export const maxDuration = 300;

type Body = {
  op?: string;
  key?: string;
  action?: string;
  enabled?: boolean;
  meta?: {
    purchasedAt?: string | null;
    provider?: string | null;
    monthlyCost?: number | string | null;
    currency?: string | null;
    renewalDay?: number | string | null;
    note?: string | null;
  };
};

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * POST — sunucu yönetimi işlemleri (yalnızca admin):
 *   { op: "refresh" }                               şimdi ölç + kontrol et
 *   { op: "cleanup", key, action }                  Docker temizliği
 *   { op: "autoCleanup", key, enabled }             Dokploy günlük temizliği
 *   { op: "meta", key, meta }                       satın alma tarihi, maliyet…
 */
export async function POST(request: Request) {
  const { session, error } = await requirePermissionApi("servers.manage");
  if (error || !session) return error;

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.op) return bad("Geçersiz istek");

  try {
    if (body.op === "refresh") {
      const result = await collectAll();
      return NextResponse.json({ ok: true, ...result });
    }

    const server = (await loadInventory()).servers.find((s) => s.key === body.key);
    if (!server) return bad("Sunucu bulunamadı", 404);

    if (body.op === "cleanup") {
      if (!body.action || !(body.action in CLEANUP_ACTIONS)) return bad("Geçersiz temizlik türü");
      const action = body.action as CleanupAction;
      const result = await runCleanup(server, action, session.user.email ?? null);
      await audit(session, {
        action: "server.cleanup",
        entity: "server",
        entityId: server.key,
        summary: `${server.name}: Docker temizliği — ${CLEANUP_ACTIONS[action].label}`,
        after: result,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (body.op === "autoCleanup") {
      if (typeof body.enabled !== "boolean") return bad("Geçersiz istek");
      await setAutoCleanup(server, body.enabled);
      await audit(session, {
        action: "server.autoCleanup",
        entity: "server",
        entityId: server.key,
        summary: `${server.name}: günlük Docker temizliği ${body.enabled ? "açıldı" : "kapatıldı"}`,
      });
      return NextResponse.json({ ok: true });
    }

    if (body.op === "meta") {
      const m = body.meta ?? {};
      const purchasedAt =
        m.purchasedAt && /^\d{4}-\d{2}-\d{2}$/.test(m.purchasedAt) ? new Date(`${m.purchasedAt}T00:00:00Z`) : null;
      const cost = m.monthlyCost === "" || m.monthlyCost == null ? null : Number(m.monthlyCost);
      const day = m.renewalDay === "" || m.renewalDay == null ? null : Number(m.renewalDay);
      if (cost != null && (!Number.isFinite(cost) || cost < 0)) return bad("Aylık ücret geçersiz");
      if (day != null && (!Number.isInteger(day) || day < 1 || day > 31)) return bad("Ödeme günü 1–31 olmalı");
      const data = {
        purchasedAt,
        provider: m.provider?.trim() || null,
        monthlyCost: cost,
        currency: (m.currency?.trim() || "USD").toUpperCase().slice(0, 3),
        renewalDay: day,
        note: m.note?.trim() || null,
      };
      await prisma.managedServer.upsert({ where: { key: server.key }, create: { key: server.key, ...data }, update: data });
      await audit(session, {
        action: "server.meta",
        entity: "server",
        entityId: server.key,
        summary: `${server.name}: sunucu bilgileri güncellendi`,
        after: data,
      });
      return NextResponse.json({ ok: true });
    }

    return bad("Bilinmeyen işlem");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return bad(message, 502);
  }
}
