/**
 * Dokploy REST istemcisi + envanter (sunucular, projeler, servisler).
 * Kimlik: `x-api-key`. Sorgular GET, değişiklikler POST (`/api/<router>.<proc>`).
 *
 * Yanıt şekilleri Dokploy sürümüne göre değişir (ör. eski sürümlerde servisler
 * doğrudan projede, yenilerde `environments[]` altında) — okuma toleranslıdır.
 */
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
 * Panelin üzerinde çalıştığı sunucu: env ile verilmediyse, panelin kendi
 * domainini (kök ya da admin.*) taşıyan Dokploy servisinin sunucusu.
 */
export function localServerKey(inv: Inventory): string | null {
  const override = localServerOverride();
  if (override) return override === "none" ? null : override;
  const root = rootDomain();
  const own = new Set([root, `www.${root}`, `admin.${root}`]);
  for (const p of inv.projects) {
    for (const s of p.services) {
      if (!s.partial && s.domains.some((d) => own.has(d.host))) return s.serverKey;
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

/**
 * Dokploy metrik ajanından (Monitoring, varsayılan port 4500) son ölçüm.
 * Önce Dokploy API'si üzerinden (güvenlik duvarı ardındaki ajan için),
 * olmazsa ajana doğrudan. Ajan kapalıysa null; ulaşılamazsa fırlatır.
 */
export async function fetchServerMetrics(server: ServerInfo): Promise<MetricSnapshot | null> {
  const inst = instanceOf(server);
  if (!inst || !server.metrics) return null;
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
