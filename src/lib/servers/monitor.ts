/**
 * Sunucu izleme: ölçüm toplama, site/SSL kontrolü, olay + WhatsApp uyarısı,
 * Docker temizliği. Zamanlayıcı (monitor-scheduler) ve cron ucu çağırır.
 */
import { prisma } from "@/lib/db";
import { genericTemplateName, sendWhatsAppTemplate, whatsappConfigured } from "@/lib/panel/notify";
import { whatsappEnabled } from "@/lib/panel/notification-settings";
import { checkSite } from "./checks";
import {
  CHECK_RETENTION_DAYS,
  DISK_CRITICAL_PCT,
  DISK_WARN_PCT,
  SAMPLE_RETENTION_DAYS,
  SSL_WARN_DAYS,
} from "./config";
import { dokployCall, fetchServerMetrics, instanceOf, loadInventory, localServerKey } from "./dokploy";
import { localMetrics } from "./local-metrics";
import { CLEANUP_ACTIONS, type CleanupAction, type MetricSnapshot, type ServerInfo } from "./types";

export type LiveSample = {
  at: string;
  /** agent = Dokploy metrik ajanı, dokploy = Dokploy'un yerleşik izlemesi, local = panelin kendi makinesi, null = kaynak yok */
  source: "agent" | "dokploy" | "local" | null;
  up: boolean;
  metric: MetricSnapshot | null;
  error: string | null;
};

const g = globalThis as typeof globalThis & {
  __593ServerLive?: Map<string, LiveSample>;
  __593ServerCollecting?: boolean;
};
const live = (g.__593ServerLive ??= new Map());

export function lastLiveSample(key: string): LiveSample | null {
  return live.get(key) ?? null;
}

export async function sampleServer(server: ServerInfo): Promise<LiveSample> {
  const at = new Date().toISOString();
  const isLocal = (await localServerKey(await loadInventory())) === server.key;
  let result: LiveSample;
  try {
    const metric = await fetchServerMetrics(server);
    if (metric) result = { at, source: server.metrics ? "agent" : "dokploy", up: true, metric, error: null };
    else if (isLocal) result = { at, source: "local", up: true, metric: await localMetrics(), error: null };
    else result = { at, source: null, up: true, metric: null, error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    result = isLocal
      ? { at, source: "local", up: true, metric: await localMetrics(), error: null }
      : { at, source: server.metrics ? "agent" : "dokploy", up: false, metric: null, error };
  }
  live.set(server.key, result);
  return result;
}

/* ───────── olaylar + bildirim ───────── */

type Condition = {
  subject: string;
  severity: "info" | "warn" | "critical";
  title: string;
  detail?: string;
};

const RANK = { info: 0, warn: 1, critical: 2 } as const;

async function notifyAdmins(serverName: string, c: Condition) {
  if (c.severity === "info") return;
  try {
    if (!whatsappConfigured() || !(await whatsappEnabled())) return;
    const admins = await prisma.user.findMany({
      where: { role: "admin", phone: { not: null } },
      select: { phone: true },
    });
    const template = genericTemplateName();
    for (const a of admins) {
      if (!a.phone) continue;
      let error: string | null = null;
      try {
        // Genel şablonun butonu /brands/{{1}} — layout bu adresi /sunucular'a yönlendirir.
        await sendWhatsAppTemplate({
          to: a.phone,
          template,
          bodyParams: [`Sunucu: ${serverName}`, c.title, c.detail || c.title],
          buttonParam: "sunucu-yonetimi",
        });
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      await prisma.notificationLog.create({
        data: { channel: "whatsapp", recipient: a.phone, template, status: error ? "failed" : "sent", error },
      });
    }
  } catch (err) {
    console.error("[server-monitor notify]", err);
  }
}

/**
 * Bir olay türünün o anki etkin koşullarını DB ile eşitler: yeni koşul → olay
 * açılır ve bildirilir; seviye yükselirse yeniden bildirilir; listede artık
 * olmayan açık olaylar kapatılır.
 */
async function syncConditions(server: ServerInfo, kind: string, active: Condition[]) {
  const open = await prisma.serverEvent.findMany({
    where: { serverKey: server.key, kind, resolvedAt: null },
  });
  for (const c of active) {
    const existing = open.find((e) => e.subject === c.subject);
    if (!existing) {
      await prisma.serverEvent.create({
        data: { serverKey: server.key, kind, subject: c.subject, severity: c.severity, title: c.title, detail: c.detail },
      });
      await notifyAdmins(server.name, c);
    } else if (RANK[c.severity] > (RANK[existing.severity as keyof typeof RANK] ?? 0)) {
      await prisma.serverEvent.update({
        where: { id: existing.id },
        data: { severity: c.severity, title: c.title, detail: c.detail },
      });
      await notifyAdmins(server.name, c);
    }
  }
  const stale = open.filter((e) => !active.some((c) => c.subject === e.subject)).map((e) => e.id);
  if (stale.length) {
    await prisma.serverEvent.updateMany({ where: { id: { in: stale } }, data: { resolvedAt: new Date() } });
  }
}

/** Sonraki ödeme günü (ay günü ayın uzunluğunu aşarsa son güne çekilir). */
export function nextRenewal(renewalDay: number, from = new Date()): Date {
  const at = (y: number, m: number) => {
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(renewalDay, last)));
  };
  const today = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const thisMonth = at(today.getUTCFullYear(), today.getUTCMonth());
  return thisMonth >= today ? thisMonth : at(today.getUTCFullYear(), today.getUTCMonth() + 1);
}

async function collectServer(server: ServerInfo, inv: Awaited<ReturnType<typeof loadInventory>>) {
  const sample = await sampleServer(server);
  const m = sample.metric;

  if (sample.source) {
    const prev = await prisma.serverSample.findFirst({
      where: { serverKey: server.key },
      orderBy: { at: "desc" },
      select: { up: true },
    });
    await prisma.serverSample.create({
      data: {
        serverKey: server.key,
        up: sample.up,
        cpuPct: m?.cpuPct,
        memPct: m?.memPct,
        memTotalGb: m?.memTotalGb,
        diskPct: m?.diskPct,
        diskTotalGb: m?.diskTotalGb,
        netInMb: m?.netInMb,
        netOutMb: m?.netOutMb,
        uptimeSec: m?.uptimeSec != null ? Math.round(m.uptimeSec) : null,
      },
    });
    // Tek seferlik ağ takılması uyarı üretmesin: art arda iki başarısız ölçüm.
    // (Önceki ölçüm başarılıysa açık olay zaten o an kapanmıştır.)
    await syncConditions(
      server,
      "server_down",
      !sample.up && prev && !prev.up
        ? [{ subject: "", severity: "critical", title: "Sunucuya ulaşılamıyor", detail: sample.error ?? undefined }]
        : [],
    );
    if (m?.diskPct != null) {
      const pct = Math.round(m.diskPct);
      await syncConditions(
        server,
        "disk_high",
        m.diskPct >= DISK_WARN_PCT
          ? [
              {
                subject: "",
                severity: m.diskPct >= DISK_CRITICAL_PCT ? "critical" : "warn",
                title: `Disk %${pct} dolu`,
                detail: `Disk doluluk %${pct}. Sunucu yönetimi sayfasından Docker temizliği yapılabilir.`,
              },
            ]
          : [],
      );
    }
  }

  // Deploy hataları: servisin son deploy'u hatalıysa açık; yeni başarılı deploy kapatır.
  const services = inv.projects.flatMap((p) =>
    p.services.filter((s) => s.serverKey === server.key).map((s) => ({ project: p, service: s })),
  );
  await syncConditions(
    server,
    "deploy_failed",
    services
      .filter(({ service }) => {
        const d = service.deploys[0];
        return d?.status === "error" && d.at && Date.now() - new Date(d.at).getTime() < 48 * 3_600_000;
      })
      .map(({ project, service }) => ({
        subject: service.id,
        severity: "warn" as const,
        title: `Deploy başarısız: ${project.name} / ${service.name}`,
        detail: service.deploys[0].error ?? service.deploys[0].title,
      })),
  );

  // Site + SSL kontrolleri.
  const domains = services.flatMap(({ service }) => service.domains);
  const results = await Promise.all(domains.map((d) => checkSite(d)));
  const down: Condition[] = [];
  const ssl: Condition[] = [];
  for (const r of results) {
    const prev = await prisma.serverSiteCheck.findFirst({
      where: { serverKey: server.key, host: r.host },
      orderBy: { at: "desc" },
      select: { ok: true },
    });
    await prisma.serverSiteCheck.create({
      data: { serverKey: server.key, host: r.host, ok: r.ok, status: r.status, ms: r.ms, sslExpiresAt: r.sslExpiresAt, error: r.error },
    });
    if (!r.ok && prev && !prev.ok) {
      down.push({ subject: r.host, severity: "critical", title: `Site açılmıyor: ${r.host}`, detail: r.error ?? undefined });
    }
    if (r.sslExpiresAt) {
      const days = Math.floor((r.sslExpiresAt.getTime() - Date.now()) / 86_400_000);
      if (days <= SSL_WARN_DAYS) {
        ssl.push({
          subject: r.host,
          severity: days <= 3 ? "critical" : "warn",
          title: days < 0 ? `SSL süresi doldu: ${r.host}` : `SSL ${days} gün sonra bitiyor: ${r.host}`,
        });
      }
    }
  }
  await syncConditions(server, "site_down", down);
  await syncConditions(server, "ssl_expiring", ssl);

  // Ödeme hatırlatması (3 gün kala).
  const meta = await prisma.managedServer.findUnique({ where: { key: server.key } });
  const renewal = meta?.renewalDay ? nextRenewal(meta.renewalDay) : null;
  const daysLeft = renewal ? Math.round((renewal.getTime() - Date.now()) / 86_400_000) : null;
  await syncConditions(
    server,
    "renewal",
    renewal && daysLeft != null && daysLeft <= 3
      ? [
          {
            subject: renewal.toISOString().slice(0, 10),
            severity: "warn",
            title: `Sunucu ödemesi ${daysLeft <= 0 ? "bugün" : `${daysLeft} gün sonra`}`,
            detail: meta?.monthlyCost ? `Aylık ${meta.monthlyCost} ${meta.currency}` : undefined,
          },
        ]
      : [],
  );
}

export async function collectAll(): Promise<{ skipped: boolean; servers: number; errors: string[] }> {
  if (g.__593ServerCollecting) return { skipped: true, servers: 0, errors: [] };
  g.__593ServerCollecting = true;
  const errors: string[] = [];
  try {
    const inv = await loadInventory(true);
    errors.push(...Object.values(inv.errors));
    for (const server of inv.servers) {
      if (inv.errors[server.instanceId]) continue;
      try {
        await collectServer(server, inv);
      } catch (err) {
        errors.push(`${server.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const now = Date.now();
    await prisma.serverSample.deleteMany({
      where: { at: { lt: new Date(now - SAMPLE_RETENTION_DAYS * 86_400_000) } },
    });
    await prisma.serverSiteCheck.deleteMany({
      where: { at: { lt: new Date(now - CHECK_RETENTION_DAYS * 86_400_000) } },
    });
    return { skipped: false, servers: inv.servers.length, errors };
  } finally {
    g.__593ServerCollecting = false;
  }
}

/* ───────── Docker temizliği ───────── */

export async function runCleanup(
  server: ServerInfo,
  action: CleanupAction,
  actorEmail: string | null,
): Promise<{ before: number | null; after: number | null }> {
  const inst = instanceOf(server);
  if (!inst) throw new Error("Dokploy kurulumu bulunamadı");
  const spec = CLEANUP_ACTIONS[action];
  const before = (await sampleServer(server)).metric?.diskPct ?? null;
  await dokployCall(inst, spec.proc, {
    body: server.serverId ? { serverId: server.serverId } : {},
    timeoutMs: 280_000,
  });
  // Metrik ajanı ~20 sn'de bir ölçer; yeni değeri görebilmek için kısa bekleme.
  const sample = lastLiveSample(server.key);
  if (sample?.source === "agent") await new Promise((r) => setTimeout(r, 22_000));
  const after = (await sampleServer(server)).metric?.diskPct ?? null;
  const fmt = (v: number | null) => (v == null ? "?" : `%${v.toFixed(1)}`);
  await prisma.serverEvent.create({
    data: {
      serverKey: server.key,
      kind: "cleanup",
      severity: "info",
      title: `Docker temizliği: ${spec.label}`,
      detail: `Disk ${fmt(before)} → ${fmt(after)}${actorEmail ? ` · ${actorEmail}` : ""}`,
      resolvedAt: new Date(),
    },
  });
  return { before, after };
}

export async function setAutoCleanup(server: ServerInfo, enabled: boolean) {
  const inst = instanceOf(server);
  if (!inst) throw new Error("Dokploy kurulumu bulunamadı");
  await dokployCall(inst, "settings.updateDockerCleanup", {
    body: { enableDockerCleanup: enabled, ...(server.serverId ? { serverId: server.serverId } : {}) },
  });
  await loadInventory(true);
}
