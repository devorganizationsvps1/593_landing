/** /sunucular sayfasının verisi — envanter + DB geçmişi + canlı ölçüm. */
import { prisma } from "@/lib/db";
import { dokployInstances, dokployMock } from "./config";
import { loadInventory, localServerKey } from "./dokploy";
import { lastLiveSample, nextRenewal, sampleServer, type LiveSample } from "./monitor";
import { RANGES, type ProjectInfo, type RangeKey, type ServerInfo } from "./types";

export { RANGES, type RangeKey };

export type SeriesPoint = {
  t: number;
  cpu: number | null;
  mem: number | null;
  disk: number | null;
  /** MB/sn */
  netIn: number | null;
  netOut: number | null;
};

export type SiteStatus = {
  host: string;
  ok: boolean;
  status: number | null;
  ms: number | null;
  error: string | null;
  sslDaysLeft: number | null;
  checkedAt: string;
  /** Son 24 saatte başarılı kontrol oranı (0–100). */
  uptime24h: number | null;
};

export type ServerEventRow = {
  id: string;
  kind: string;
  severity: string;
  title: string;
  detail: string | null;
  at: string;
  resolvedAt: string | null;
};

export type ServerTab = {
  key: string;
  name: string;
  /** ok | warn | critical | unknown */
  health: "ok" | "warn" | "critical" | "unknown";
  diskPct: number | null;
  openEvents: number;
};

export type ServerMeta = {
  purchasedAt: string | null;
  provider: string | null;
  monthlyCost: number | null;
  currency: string;
  renewalDay: number | null;
  note: string | null;
  nextRenewal: string | null;
};

export type ServerPageData = {
  configured: boolean;
  mock: boolean;
  tabs: ServerTab[];
  selected: {
    server: Omit<ServerInfo, "metrics"> & { monitoring: boolean; isLocal: boolean };
    instanceError: string | null;
    live: LiveSample | null;
    meta: ServerMeta;
    range: RangeKey;
    series: SeriesPoint[];
    /** Aralıktaki ölçümlerin yüzde kaçı başarılı. */
    uptimePct: number | null;
    sampleCount: number;
    /** Mevcut eğilimle diskin dolmasına kalan gün; eğilim yoksa null. */
    diskFullInDays: number | null;
    projects: ProjectInfo[];
    sites: Record<string, SiteStatus>;
    events: ServerEventRow[];
  } | null;
};

const avg = (xs: Array<number | null>): number | null => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

function diskForecast(points: Array<{ at: Date; diskPct: number | null }>): number | null {
  const pts = points.filter((p): p is { at: Date; diskPct: number } => p.diskPct != null);
  if (pts.length < 24) return null;
  const t0 = pts[0].at.getTime();
  const xs = pts.map((p) => (p.at.getTime() - t0) / 86_400_000);
  if (xs[xs.length - 1] < 1) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = pts.reduce((a, p) => a + p.diskPct, 0) / pts.length;
  let sxy = 0;
  let sxx = 0;
  pts.forEach((p, i) => {
    sxy += (xs[i] - mx) * (p.diskPct - my);
    sxx += (xs[i] - mx) ** 2;
  });
  const slope = sxx > 0 ? sxy / sxx : 0;
  if (slope < 0.05) return null;
  const days = (100 - pts[pts.length - 1].diskPct) / slope;
  return days > 365 ? null : Math.max(0, Math.round(days));
}

export async function loadServerPage(opts: {
  key?: string;
  range?: string;
  /** Yalnızca üst sekmeler (hosting sayfası için). */
  tabsOnly?: boolean;
}): Promise<ServerPageData> {
  const configured = dokployInstances().length > 0;
  if (!configured) return { configured, mock: false, tabs: [], selected: null };

  const inv = await loadInventory();
  const keys = inv.servers.map((s) => s.key);
  const [latest, openEvents] = await Promise.all([
    prisma.serverSample.findMany({
      where: { serverKey: { in: keys } },
      orderBy: { at: "desc" },
      distinct: ["serverKey"],
      select: { serverKey: true, up: true, diskPct: true },
    }),
    prisma.serverEvent.findMany({
      where: { serverKey: { in: keys }, resolvedAt: null },
      select: { serverKey: true, severity: true },
    }),
  ]);

  const tabs: ServerTab[] = inv.servers.map((s) => {
    const l = latest.find((x) => x.serverKey === s.key);
    const ev = openEvents.filter((e) => e.serverKey === s.key && e.severity !== "info");
    const health = inv.errors[s.instanceId] || (l && !l.up) || ev.some((e) => e.severity === "critical")
      ? "critical"
      : ev.length
        ? "warn"
        : l
          ? "ok"
          : "unknown";
    return { key: s.key, name: s.name, health, diskPct: l?.diskPct ?? null, openEvents: ev.length };
  });

  const server = inv.servers.find((s) => s.key === opts.key) ?? inv.servers[0];
  if (!server || opts.tabsOnly) return { configured, mock: dokployMock(), tabs, selected: null };

  const range: RangeKey = opts.range && opts.range in RANGES ? (opts.range as RangeKey) : "24h";
  const since = new Date(Date.now() - RANGES[range].ms);
  const instanceError = inv.errors[server.instanceId] ?? null;

  // Canlı ölçüm sayfayı bekletmez: bellekteki son ölçüm (zamanlayıcı 5 dk'da
  // bir yeniler) kullanılır; eskiyse arka planda tazelenir.
  const cached = lastLiveSample(server.key);
  if (!instanceError && (!cached || Date.now() - new Date(cached.at).getTime() > 90_000)) {
    void sampleServer(server).catch(() => undefined);
  }
  const [rows, weekRows, metaRow, events, checks] = await Promise.all([
    prisma.serverSample.findMany({ where: { serverKey: server.key, at: { gte: since } }, orderBy: { at: "asc" } }),
    prisma.serverSample.findMany({
      where: { serverKey: server.key, at: { gte: new Date(Date.now() - 7 * 86_400_000) }, up: true },
      orderBy: { at: "asc" },
      select: { at: true, diskPct: true },
    }),
    prisma.managedServer.findUnique({ where: { key: server.key } }),
    prisma.serverEvent.findMany({ where: { serverKey: server.key }, orderBy: { at: "desc" }, take: 40 }),
    prisma.serverSiteCheck.findMany({
      where: { serverKey: server.key, at: { gte: new Date(Date.now() - 86_400_000) } },
      orderBy: { at: "desc" },
    }),
  ]);
  // Süreç yeni başladıysa bellekte ölçüm yoktur → son kayıtlı ölçümden kur.
  const lastRow = rows.at(-1);
  const liveSample: LiveSample | null =
    cached ??
    (lastRow
      ? {
          at: lastRow.at.toISOString(),
          source: "dokploy",
          up: lastRow.up,
          error: null,
          metric: lastRow.up
            ? {
                cpuPct: lastRow.cpuPct,
                memPct: lastRow.memPct,
                memTotalGb: lastRow.memTotalGb,
                diskPct: lastRow.diskPct,
                diskTotalGb: lastRow.diskTotalGb,
                netInMb: lastRow.netInMb,
                netOutMb: lastRow.netOutMb,
                uptimeSec: lastRow.uptimeSec,
                os: null,
                kernel: null,
                arch: null,
                cpuModel: null,
                cpuCores: null,
              }
            : null,
        }
      : null);

  // Ağ: sayaç farkı → MB/sn (sayaç sıfırlandıysa atlanır).
  const raw: SeriesPoint[] = rows.map((r, i) => {
    const p = rows[i - 1];
    const dt = p ? (r.at.getTime() - p.at.getTime()) / 1000 : 0;
    const rate = (a: number | null, b: number | null | undefined) =>
      a != null && b != null && dt > 0 && dt < 3600 && a >= b ? (a - b) / dt : null;
    return {
      t: r.at.getTime(),
      cpu: r.up ? r.cpuPct : null,
      mem: r.up ? r.memPct : null,
      disk: r.up ? r.diskPct : null,
      netIn: r.up ? rate(r.netInMb, p?.netInMb) : null,
      netOut: r.up ? rate(r.netOutMb, p?.netOutMb) : null,
    };
  });
  const bucketMs = RANGES[range].bucketMs;
  let series = raw;
  if (bucketMs) {
    const buckets = new Map<number, SeriesPoint[]>();
    for (const p of raw) {
      const b = Math.floor(p.t / bucketMs) * bucketMs;
      (buckets.get(b) ?? buckets.set(b, []).get(b)!).push(p);
    }
    series = [...buckets.entries()].map(([t, ps]) => ({
      t,
      cpu: avg(ps.map((p) => p.cpu)),
      mem: avg(ps.map((p) => p.mem)),
      disk: avg(ps.map((p) => p.disk)),
      netIn: avg(ps.map((p) => p.netIn)),
      netOut: avg(ps.map((p) => p.netOut)),
    }));
  }

  const sites: Record<string, SiteStatus> = {};
  for (const c of checks) {
    if (sites[c.host]) continue;
    const all = checks.filter((x) => x.host === c.host);
    sites[c.host] = {
      host: c.host,
      ok: c.ok,
      status: c.status,
      ms: c.ms,
      error: c.error,
      sslDaysLeft: c.sslExpiresAt ? Math.floor((c.sslExpiresAt.getTime() - Date.now()) / 86_400_000) : null,
      checkedAt: c.at.toISOString(),
      uptime24h: all.length ? (all.filter((x) => x.ok).length / all.length) * 100 : null,
    };
  }

  const projects = inv.projects
    .map((p) => ({ ...p, services: p.services.filter((s) => s.serverKey === server.key) }))
    .filter((p) => p.services.length > 0);

  const { metrics, ...pub } = server;
  return {
    configured,
    mock: dokployMock(),
    tabs,
    selected: {
      server: { ...pub, monitoring: Boolean(metrics), isLocal: (await localServerKey(inv)) === server.key },
      instanceError,
      live: liveSample,
      meta: {
        purchasedAt: metaRow?.purchasedAt?.toISOString().slice(0, 10) ?? null,
        provider: metaRow?.provider ?? null,
        monthlyCost: metaRow?.monthlyCost != null ? Number(metaRow.monthlyCost) : null,
        currency: metaRow?.currency ?? "USD",
        renewalDay: metaRow?.renewalDay ?? null,
        note: metaRow?.note ?? null,
        nextRenewal: metaRow?.renewalDay ? nextRenewal(metaRow.renewalDay).toISOString().slice(0, 10) : null,
      },
      range,
      series,
      uptimePct: rows.length ? (rows.filter((r) => r.up).length / rows.length) * 100 : null,
      sampleCount: rows.length,
      diskFullInDays: diskForecast(weekRows),
      projects,
      sites,
      events: events.map((e) => ({
        id: e.id,
        kind: e.kind,
        severity: e.severity,
        title: e.title,
        detail: e.detail,
        at: e.at.toISOString(),
        resolvedAt: e.resolvedAt?.toISOString() ?? null,
      })),
    },
  };
}
