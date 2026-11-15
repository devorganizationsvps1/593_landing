/**
 * Dokploy REST istemcisi + envanter (sunucular, projeler, servisler).
 * Kimlik: `x-api-key`. Sorgular GET, değişiklikler POST (`/api/<router>.<proc>`).
 *
 * Yanıt şekilleri Dokploy sürümüne göre değişir (ör. eski sürümlerde servisler
 * doğrudan projede, yenilerde `environments[]` altında) — okuma toleranslıdır.
 */
import WebSocket from "ws";
import { rootDomain } from "@/lib/panel/host";
import { dokployInstances, dokployMock, localServerOverride, serverKey, type DokployInstance } from "./config";
import { mockCall } from "./mock";
import type {
  DeployInfo,
  DomainInfo,
  Inventory,
  MetricSnapshot,
  ProjectInfo,
  ServerInfo,
  ServiceInfo,
  ServiceKind,
} from "./types";

type Json = Record<string, unknown>;

export class DokployError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = "DokployError";
  }
}

export async function dokployCall<T = unknown>(
  inst: DokployInstance,
  proc: string,
  opts: { query?: Record<string, string>; body?: Json; timeoutMs?: number } = {},
): Promise<T> {
  if (dokployMock()) return mockCall(inst, proc, opts.query ?? opts.body ?? {}) as T;

  const qs = opts.query ? `?${new URLSearchParams(opts.query)}` : "";
  let res: Response;
  try {
    res = await fetch(`${inst.url}/api/${proc}${qs}`, {
      method: opts.body ? "POST" : "GET",
      headers: {
        "x-api-key": inst.apiKey,
        accept: "application/json",
        ...(opts.body ? { "content-type": "application/json" } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new DokployError(`Dokploy'a ulaşılamadı (${proc}): ${msg}`, null);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* JSON değil */
  }
  if (!res.ok) {
    const m = (json as { message?: string } | null)?.message;
    throw new DokployError(
      res.status === 401 || res.status === 403
        ? `Dokploy API anahtarı reddedildi (${proc}, HTTP ${res.status})`
        : `Dokploy ${proc}: ${m || `HTTP ${res.status}`}`,
      res.status,
    );
  }
  return json as T;
}

/* ───────── toleranslı okuma yardımcıları ───────── */

const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): Json[] => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}
function iso(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function metricsConfig(v: unknown): ServerInfo["metrics"] {
  const s = obj(obj(v).server);
  const token = str(s.token);
  const port = num(s.port);
  return token && port ? { port, token } : null;
}

const KINDS: Array<{ kind: ServiceKind; rel: string; idField: string }> = [
  { kind: "application", rel: "applications", idField: "applicationId" },
  { kind: "compose", rel: "compose", idField: "composeId" },
  { kind: "postgres", rel: "postgres", idField: "postgresId" },
  { kind: "mysql", rel: "mysql", idField: "mysqlId" },
  { kind: "mariadb", rel: "mariadb", idField: "mariadbId" },
  { kind: "mongo", rel: "mongo", idField: "mongoId" },
  { kind: "redis", rel: "redis", idField: "redisId" },
  { kind: "libsql", rel: "libsql", idField: "libsqlId" },
];

function deploys(v: unknown): DeployInfo[] {
  return arr(v)
    .map((d) => ({
      id: str(d.deploymentId) ?? "",
      title: str(d.title) ?? "Deploy",
      status: str(d.status) ?? "unknown",
      at: iso(d.createdAt) ?? iso(d.startedAt),
      error: str(d.errorMessage),
    }))
    .filter((d) => d.id)
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
    .slice(0, 5);
}

function domains(v: unknown): DomainInfo[] {
  const seen = new Set<string>();
  const out: DomainInfo[] = [];
  for (const d of arr(v)) {
    const host = str(d.host)?.toLowerCase();
    if (!host || seen.has(host)) continue;
    seen.add(host);
    out.push({ host, https: d.https === true, path: str(d.path) ?? "/" });
  }
  return out;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function instanceInventory(
  inst: DokployInstance,
): Promise<{ servers: ServerInfo[]; projects: ProjectInfo[] }> {
  // project.all hata verirse kurulum "erişilemedi" sayılır; diğerleri opsiyonel.
  const soft = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
  const [rawProjects, rawServers, web, ip, version] = await Promise.all([
    dokployCall<unknown>(inst, "project.all"),
    soft(dokployCall<unknown>(inst, "server.all")),
    soft(dokployCall<unknown>(inst, "settings.getWebServerSettings")),
    soft(dokployCall<unknown>(inst, "settings.getIp")),
    soft(dokployCall<unknown>(inst, "settings.getDokployVersion")),
  ]);

  const dokployVersion = str(version);
  const webObj = obj(web);
  const servers: ServerInfo[] = [
    {
      key: serverKey(inst.id, null),
      instanceId: inst.id,
      serverId: null,
      name: inst.label,
      ip: str(ip) ?? str(webObj.serverIp),
      addedAt: null,
      dokployUrl: inst.url,
      dokployVersion,
      dockerCleanup: typeof webObj.enableDockerCleanup === "boolean" ? webObj.enableDockerCleanup : null,
      metrics: metricsConfig(webObj.metricsConfig),
    },
    ...arr(rawServers)
      .filter((s) => str(s.serverId) && (str(s.serverType) ?? "deploy") === "deploy")
      .map((s) => ({
        key: serverKey(inst.id, str(s.serverId)),
        instanceId: inst.id,
        serverId: str(s.serverId),
        name: str(s.name) ?? "Uzak sunucu",
        ip: str(s.ipAddress),
        addedAt: iso(s.createdAt),
        dokployUrl: inst.url,
        dokployVersion,
        dockerCleanup: typeof s.enableDockerCleanup === "boolean" ? s.enableDockerCleanup : null,
        metrics: metricsConfig(s.metricsConfig),
      })),
  ];

  type Ref = { project: ProjectInfo; kind: ServiceKind; idField: string; row: Json; env: string | null };
  const refs: Ref[] = [];
  const projects: ProjectInfo[] = arr(rawProjects).map((p) => {
    const project: ProjectInfo = {
      id: str(p.projectId) ?? "",
      name: str(p.name) ?? "Proje",
      description: str(p.description),
      createdAt: iso(p.createdAt),
      services: [],
    };
    const envs = arr(p.environments);
    const scopes: Array<{ env: string | null; holder: Json }> = envs.length
      ? envs.map((e) => ({ env: envs.length > 1 ? str(e.name) : null, holder: e }))
      : [{ env: null, holder: p }];
    for (const { env, holder } of scopes) {
      for (const k of KINDS) {
        for (const row of arr(holder[k.rel])) {
          if (str(row[k.idField])) refs.push({ project, kind: k.kind, idField: k.idField, row, env });
        }
      }
    }
    return project;
  });

  const services = await mapLimit(refs, 5, async (ref): Promise<ServiceInfo> => {
    const id = str(ref.row[ref.idField])!;
    const detail = obj(
      await soft(dokployCall<unknown>(inst, `${ref.kind}.one`, { query: { [ref.idField]: id } })),
    );
    const partial = Object.keys(detail).length === 0;
    const src = partial ? ref.row : detail;
    return {
      id,
      kind: ref.kind,
      name: str(src.name) ?? ref.kind,
      appName: str(src.appName),
      status: str(src.applicationStatus) ?? str(src.composeStatus) ?? str(ref.row.applicationStatus) ?? str(ref.row.composeStatus),
      createdAt: iso(src.createdAt),
      serverKey: serverKey(inst.id, str(src.serverId)),
      partial,
      environment: ref.env,
      domains: domains(src.domains),
      deploys: deploys(src.deployments),
    };
  });
  services.forEach((s, i) => refs[i].project.services.push(s));

  return { servers, projects: projects.filter((p) => p.id) };
}

type Cache = { at: number; data: Inventory };
const g = globalThis as typeof globalThis & { __593Inventory?: Cache };
const CACHE_MS = 60_000;

/** Tüm kurulumların envanteri. 60 sn bellekte tutulur; `force` yeniler. */
export async function loadInventory(force = false): Promise<Inventory> {
  if (!force && g.__593Inventory && Date.now() - g.__593Inventory.at < CACHE_MS) {
    return g.__593Inventory.data;
  }
  const data: Inventory = { servers: [], projects: [], errors: {}, fetchedAt: new Date().toISOString() };
  await Promise.all(
    dokployInstances().map(async (inst) => {
      try {
        const r = await instanceInventory(inst);
        data.servers.push(...r.servers);
        data.projects.push(...r.projects);
      } catch (err) {
        data.errors[inst.id] = err instanceof Error ? err.message : String(err);
        // Erişilemese de sekmesi görünsün.
        data.servers.push({
          key: serverKey(inst.id, null),
          instanceId: inst.id,
          serverId: null,
          name: inst.label,
          ip: null,
          addedAt: null,
          dokployUrl: inst.url,
          dokployVersion: null,
          dockerCleanup: null,
          metrics: null,
        });
      }
    }),
  );
  data.servers.sort((a, b) => a.key.localeCompare(b.key));
  g.__593Inventory = { at: Date.now(), data };
  return data;
}

/**
 * Panelin üzerinde çalıştığı sunucu. Sırayla: env ile verilen; panelin kendi
 * domainini (kök / www / admin) taşıyan Dokploy servisinin sunucusu; panelin
 * dışa çıkış IP'siyle aynı IP'ye sahip sunucu. Sonuç envanterle birlikte
 * önbelleğe alınır.
 */
export async function localServerKey(inv: Inventory): Promise<string | null> {
  const override = localServerOverride();
  if (override) return override === "none" ? null : override;
  // Geliştirme makinesi hiçbir zaman sunuculardan biri değildir.
  if (process.env.NODE_ENV !== "production") return null;
  if (gl.__593LocalKey?.for === inv.fetchedAt) return gl.__593LocalKey.key;

  const root = rootDomain();
  const own = [root, `admin.${root}`, `www.${root}`];
  let key: string | null = null;
  for (const p of inv.projects) {
    for (const s of p.services) {
      if (!s.partial && s.domains.some((d) => own.includes(d.host))) key ??= s.serverKey;
    }
  }
  if (!key) {
    const ip = await ownPublicIp();
    key = (ip && inv.servers.find((s) => s.ip === ip)?.key) || null;
  }
  gl.__593LocalKey = { for: inv.fetchedAt, key };
  return key;
}
const gl = globalThis as typeof globalThis & {
  __593LocalKey?: { for: string; key: string | null };
  __593PublicIp?: string;
};

/**
 * Panelin dışarıya çıktığı IP. Domain Cloudflare arkasında olduğundan DNS
 * kaydı sunucu IP'sini vermez; bu yüzden dış bir "IP'm ne" ucuna sorulur
 * (istekte hiçbir veri gönderilmez). Süreç boyunca bir kez.
 */
async function ownPublicIp(): Promise<string | null> {
  if (gl.__593PublicIp) return gl.__593PublicIp;
  const sources: Array<[string, (t: string) => string | undefined]> = [
    ["https://1.1.1.1/cdn-cgi/trace", (t) => /^ip=(.+)$/m.exec(t)?.[1]],
    ["https://api.ipify.org", (t) => t],
  ];
  for (const [url, pick] of sources) {
    try {
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
      const ip = pick(await res.text())?.trim();
      if (res.ok && ip && /^[0-9a-f.:]+$/i.test(ip)) return (gl.__593PublicIp = ip);
    } catch {
      /* sıradaki */
    }
  }
  return null;
}

export function instanceOf(server: ServerInfo): DokployInstance | null {
  return dokployInstances().find((i) => i.id === server.instanceId) ?? null;
}

/* ───────── metrikler ───────── */

function parseMetric(row: Json): MetricSnapshot {
  return {
    cpuPct: num(row.cpu),
    memPct: num(row.memUsed),
    memTotalGb: num(row.memTotal),
    diskPct: num(row.diskUsed),
    diskTotalGb: num(row.totalDisk),
    netInMb: num(row.networkIn),
    netOutMb: num(row.networkOut),
    uptimeSec: num(row.uptime),
    os: str(row.distro) ?? str(row.os),
    kernel: str(row.kernel),
    arch: str(row.arch),
    cpuModel: str(row.cpuModel),
    cpuCores: num(row.cpuCores),
  };
}

function lastRow(v: unknown): Json | null {
  const rows = arr(v);
  return rows.length ? rows[rows.length - 1] : null;
}

/** "3.40GiB" → GiB. */
function toGib(v: unknown): number | null {
  const m = /^([\d.]+)\s*([KMGT])i?B$/i.exec(String(v ?? "").trim());
  if (!m) return null;
  const exp = { K: -2, M: -1, G: 0, T: 1 }[m[2].toUpperCase() as "K" | "M" | "G" | "T"];
  return Number.parseFloat(m[1]) * 1024 ** exp;
}

/** Dokploy'un yerleşik (ajansız) izleme kaydı: { cpu, memory, disk, network } son girdileri. */
function parseFreeStats(data: Json, maxAgeMs: number): MetricSnapshot | null {
  const entry = (k: string) => {
    const e = obj(data[k]);
    const t = iso(e.time);
    return t && Date.now() - new Date(t).getTime() <= maxAgeMs ? e.value : undefined;
  };
  const cpu = entry("cpu");
  const mem = obj(entry("memory"));
  const disk = obj(entry("disk"));
  const net = obj(entry("network"));
  const used = toGib(mem.used);
  const total = toGib(mem.total);
  const snap: MetricSnapshot = {
    cpuPct: num(cpu),
    memPct: used != null && total ? (used / total) * 100 : null,
    memTotalGb: total,
    diskPct: num(disk.diskUsedPercentage),
    diskTotalGb: num(disk.diskTotal),
    netInMb: num(net.inputMb),
    netOutMb: num(net.outputMb),
    uptimeSec: null,
    os: null,
    kernel: null,
    arch: null,
    cpuModel: null,
    cpuCores: null,
  };
  return snap.cpuPct == null && snap.memPct == null && snap.diskPct == null ? null : snap;
}

/**
 * Dokploy'un kendi makinesinin anlık ölçümü — Monitoring sayfasını besleyen
 * WebSocket akışından tek mesaj (ajan gerekmez, API anahtarıyla). Akış
 * açılamazsa son 10 dakikada kaydedilmiş değer; o da yoksa null.
 * Dokploy'a hiç ulaşılamıyorsa fırlatır.
 */
async function fetchFreeMetrics(inst: DokployInstance): Promise<MetricSnapshot | null> {
  if (dokployMock()) return null;
  const viaWs = await new Promise<MetricSnapshot | null>((resolve) => {
    const ws = new WebSocket(
      `${inst.url.replace(/^http/, "ws")}/listen-docker-stats-monitoring?appName=dokploy&appType=application`,
      { headers: { "x-api-key": inst.apiKey }, handshakeTimeout: 8_000 },
    );
    const done = (v: MetricSnapshot | null) => {
      clearTimeout(timer);
      ws.removeAllListeners();
      ws.on("error", () => undefined);
      ws.terminate();
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 10_000);
    ws.on("message", (raw) => {
      try {
        const snap = parseFreeStats(obj(obj(JSON.parse(String(raw))).data), 60_000);
        if (snap) done(snap);
      } catch {
        /* sonraki mesajı bekle */
      }
    });
    ws.on("error", () => done(null));
    ws.on("close", () => done(null));
  });
  if (viaWs) return viaWs;
  // Akış yoksa: API ayakta mı? (değilse sunucu "erişilemez" sayılır)
  const stored = await dokployCall<unknown>(inst, "application.readAppMonitoring", {
    query: { appName: "dokploy" },
    timeoutMs: 10_000,
  }).catch((err) => {
    if (err instanceof DokployError && err.status === null) throw err;
    return null;
  });
  const last = (k: string) => arr(obj(stored)[k]).at(-1) ?? {};
  return parseFreeStats(
    { cpu: last("cpu"), memory: last("memory"), disk: last("disk"), network: last("network") },
    10 * 60_000,
  );
}

export type DockerDiskItem = {
  type: string;
  sizeBytes: number;
  reclaimable: string | null;
  active: number | null;
  total: number | null;
};

/** `docker system df` dökümü — yalnızca Dokploy'un kendi makinesi için var. */
export async function fetchDockerDiskUsage(server: ServerInfo): Promise<DockerDiskItem[] | null> {
  const inst = instanceOf(server);
  if (!inst || server.serverId || dokployMock()) return null;
  try {
    const rows = arr(await dokployCall<unknown>(inst, "settings.getDockerDiskUsage", { timeoutMs: 20_000 }));
    const items = rows
      .map((r) => ({
        type: str(r.type) ?? "?",
        sizeBytes: num(r.sizeBytes) ?? 0,
        reclaimable: str(r.reclaimable),
        active: num(r.active),
        total: num(r.totalCount),
      }))
      .filter((r) => r.sizeBytes > 0);
    return items.length ? items : null;
  } catch {
    return null;
  }
}

/**
 * Dokploy metrik ajanından (Monitoring, varsayılan port 4500) son ölçüm.
 * Ajan kurulu değilse ve sunucu Dokploy'un kendi makinesiyse yerleşik izleme.
 * Önce Dokploy API'si üzerinden (güvenlik duvarı ardındaki ajan için),
 * olmazsa ajana doğrudan. Ajan kapalıysa null; ulaşılamazsa fırlatır.
 */
export async function fetchServerMetrics(server: ServerInfo): Promise<MetricSnapshot | null> {
  const inst = instanceOf(server);
  if (!inst) return null;
  if (!server.metrics) return server.serverId ? null : fetchFreeMetrics(inst);
  const host = server.ip ?? new URL(inst.url).hostname;
  const base = `http://${host}:${server.metrics.port}`;
  try {
    const viaApi = lastRow(
      await dokployCall<unknown>(inst, "server.getServerMetrics", {
        query: { url: base, token: server.metrics.token, dataPoints: "1" },
        timeoutMs: 10_000,
      }),
    );
    if (viaApi) return parseMetric(viaApi);
  } catch {
    /* doğrudan dene */
  }
  const res = await fetch(`${base}/metrics?limit=1`, {
    headers: { Authorization: `Bearer ${server.metrics.token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Metrik ajanı HTTP ${res.status}`);
  const row = lastRow(await res.json());
  if (!row) throw new Error("Metrik ajanı henüz veri üretmedi");
  return parseMetric(row);
}
