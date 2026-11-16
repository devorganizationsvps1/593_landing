"use client";

import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { DISK_CRITICAL_PCT, DISK_WARN_PCT } from "@/lib/servers/config";
import type { HostingRow } from "@/lib/servers/hosting";
import type { ServerMeta, ServerPageData, SiteStatus } from "@/lib/servers/queries";
import { CLEANUP_ACTIONS, RANGES, type CleanupAction, type ProjectInfo, type RangeKey, type ServiceInfo } from "@/lib/servers/types";
import HostingTracker from "./HostingTracker";
import { ServerCharts } from "./ServerCharts";
import {
  BTN,
  BTN_QUIET,
  BTN_SOLID,
  FIELD,
  FRAME,
  LABEL,
  SoftLink,
  Status,
  age,
  colorMap,
  fmtDate,
  fmtDateTime,
  pct,
  post,
  type Tone,
} from "./ui";

/* ───────── yardımcılar ───────── */

function duration(sec: number | null | undefined): string {
  if (sec == null) return "—";
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3600);
  return d > 0 ? `${d} gün ${h} saat` : `${h} saat ${Math.floor((sec % 3600) / 60)} dk`;
}

function loadTone(v: number | null | undefined, warn: number, critical: number): Tone {
  if (v == null) return "unknown";
  return v >= critical ? "critical" : v >= warn ? "warn" : "ok";
}

const SERVICE_STATUS: Record<string, { tone: Tone; label: string }> = {
  done: { tone: "ok", label: "Çalışıyor" },
  running: { tone: "warn", label: "Deploy ediliyor" },
  idle: { tone: "unknown", label: "Durduruldu" },
  error: { tone: "critical", label: "Hata" },
};

const KIND_LABEL: Record<ServiceInfo["kind"], string> = {
  application: "Uygulama",
  compose: "Compose",
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  mongo: "MongoDB",
  redis: "Redis",
  libsql: "libSQL",
};

function projectHealth(project: ProjectInfo, sites: Record<string, SiteStatus>): { tone: Tone; label: string } {
  const hosts = project.services.flatMap((s) => s.domains.map((d) => d.host));
  const siteDown = hosts.filter((h) => sites[h] && !sites[h].ok).length;
  const errors = project.services.filter((s) => s.status === "error" || s.deploys[0]?.status === "error").length;
  if (siteDown) return { tone: "critical", label: `${siteDown} site açılmıyor` };
  if (errors) return { tone: "critical", label: `${errors} serviste hata` };
  if (project.services.some((s) => s.status === "running")) return { tone: "warn", label: "Deploy ediliyor" };
  if (project.services.some((s) => s.status === "done")) return { tone: "ok", label: "Çalışıyor" };
  return { tone: "unknown", label: "Durduruldu" };
}

/* ───────── parçalar ───────── */

/** Gösterge: Durum panosundaki kartlar gibi dolu renkli blok. */
function Meter({
  label,
  value,
  tone,
  sub,
  color,
}: {
  label: string;
  value: number | null | undefined;
  tone: Tone;
  sub?: React.ReactNode;
  color: string;
}) {
  const word = tone === "critical" ? "Kritik" : tone === "warn" ? "Yüksek" : null;
  return (
    <div className="rounded-xl px-4 py-4 text-white" style={{ background: color }}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-semibold text-white/85">{label}</span>
        {word ? <Status tone={tone} onColor>{word}</Status> : null}
      </div>
      <p className="mt-1 text-[30px] font-semibold leading-none tabular-nums tracking-tight">{pct(value, 1)}</p>
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/25"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value ?? undefined}
      >
        <div className="h-full rounded-full bg-white" style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }} />
      </div>
      <p className="mt-2 min-h-[1.25rem] text-[13px] tabular-nums text-white/85">{sub}</p>
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="min-w-0 px-5 py-3">
      <dt className="text-[13px] text-panel-fg-secondary">{label}</dt>
      <dd className="mt-0.5 truncate text-[15px] font-semibold tabular-nums text-panel-fg">{value}</dd>
      {hint ? <dd className="truncate text-[12px] text-panel-fg-secondary">{hint}</dd> : null}
    </div>
  );
}

function SiteLine({ host, site }: { host: string; site: SiteStatus | undefined }) {
  const sslBad = site?.sslDaysLeft != null && site.sslDaysLeft <= 14;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-2 text-[13px] sm:grid-cols-[minmax(0,1fr)_9rem_8rem_7rem]">
      <a href={`https://${host}`} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1.5 font-medium text-panel-fg hover:underline">
        <span className="truncate">{host}</span>
        <ExternalLink className="size-3 shrink-0 text-panel-fg-muted" aria-hidden />
      </a>
      {site ? (
        <>
          <Status tone={site.ok ? "ok" : "critical"}>
            {site.ok ? `${site.status ?? "Açık"}, ${site.ms ?? "?"} ms` : (site.error ?? "Açılmıyor")}
          </Status>
          <span className="tabular-nums text-panel-fg-secondary">
            {site.uptime24h != null ? `24 saat ${pct(site.uptime24h, 1)}` : ""}
          </span>
          <span className={`tabular-nums ${sslBad ? "font-semibold text-panel-critical" : "text-panel-fg-secondary"}`}>
            {site.sslDaysLeft == null ? "" : site.sslDaysLeft < 0 ? "SSL doldu" : `SSL ${site.sslDaysLeft} gün`}
          </span>
        </>
      ) : (
        <span className="text-panel-fg-muted sm:col-span-3">henüz kontrol edilmedi</span>
      )}
    </div>
  );
}

/** Proje kutusu — Durum panosundaki kartlar gibi dolu renkli; ayrıntı alt sayfada. */
function ProjectCell({
  project,
  sites,
  href,
  color,
}: {
  project: ProjectInfo;
  sites: Record<string, SiteStatus>;
  href: string;
  color: string;
}) {
  const health = projectHealth(project, sites);
  const host = project.services.flatMap((s) => s.domains)[0]?.host;
  return (
    <SoftLink
      href={href}
      className="flex min-h-[7.5rem] flex-col rounded-xl px-4 py-3.5 text-white transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#141111]"
      style={{ background: color }}
    >
      <h3 className="truncate text-[15px] font-semibold">{project.name}</h3>
      <p className="truncate text-[13px] text-white/85">{host ?? project.description ?? "Domain yok"}</p>
      <div className="mt-auto flex items-end justify-between gap-3 pt-4 text-[13px]">
        <Status tone={health.tone} onColor>
          {health.label}
        </Status>
        <span className="shrink-0 tabular-nums text-white/85" title={fmtDate(project.createdAt)}>
          {project.services.length} servis, {age(project.createdAt)}
        </span>
      </div>
    </SoftLink>
  );
}

/** Proje alt sayfası. */
function ProjectDetail({
  project,
  sites,
  serverName,
  backHref,
  color,
}: {
  color: string;
  project: ProjectInfo;
  sites: Record<string, SiteStatus>;
  serverName: string;
  backHref: string;
}) {
  const health = projectHealth(project, sites);
  const domainCount = project.services.reduce((n, s) => n + s.domains.length, 0);
  const lastDeploy = project.services.flatMap((s) => s.deploys).sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))[0];
  return (
    <section className={FRAME}>
      <div className="border-b border-panel-border px-5 py-3">
        <SoftLink href={backHref} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-panel-fg-secondary hover:text-panel-fg">
          <ArrowLeft className="size-4" aria-hidden />
          {serverName} projeleri
        </SoftLink>
      </div>
      <header className="px-5 py-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span aria-hidden className="size-4 rounded" style={{ background: color }} />
          <h2 className="text-xl font-semibold tracking-tight text-panel-fg">{project.name}</h2>
          <Status tone={health.tone}>{health.label}</Status>
        </div>
        {project.description ? <p className="mt-1 text-[13px] text-panel-fg-secondary">{project.description}</p> : null}
      </header>
      <dl className="grid grid-cols-2 border-t border-panel-border sm:grid-cols-4 sm:divide-x sm:divide-panel-border">
        <Fact label="Açılış tarihi" value={fmtDate(project.createdAt)} hint={`${age(project.createdAt)} önce`} />
        <Fact label="Servis" value={project.services.length} />
        <Fact label="Domain" value={domainCount} />
        <Fact label="Son deploy" value={fmtDateTime(lastDeploy?.at)} hint={lastDeploy?.title} />
      </dl>

      {project.services.map((s) => {
        const st = SERVICE_STATUS[s.status ?? ""] ?? { tone: "unknown" as Tone, label: s.status ?? "Bilinmiyor" };
        return (
          <article key={`${s.kind}:${s.id}`} className="border-t border-panel-border-strong">
            <div className="grid items-center gap-x-6 gap-y-1 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_10rem_12rem]">
              <h3 className="truncate text-[15px] font-semibold text-panel-fg">
                {s.name}
                <span
                  className="ml-2 inline-block rounded-full px-2 py-0.5 align-middle text-[12px] font-semibold text-white"
                  style={{ background: s.kind === "application" ? "#2563eb" : s.kind === "compose" ? "#7c3aed" : "#16a34a" }}
                >
                  {KIND_LABEL[s.kind]}
                </span>
                {s.environment ? <span className="ml-2 text-[13px] font-normal text-panel-fg-secondary">{s.environment}</span> : null}
              </h3>
              <Status tone={st.tone}>{st.label}</Status>
              <span className="text-[13px] tabular-nums text-panel-fg-secondary sm:text-right">
                {s.partial ? "detay alınamadı" : `${fmtDate(s.createdAt)} açıldı`}
              </span>
            </div>

            {s.domains.length ? (
              <div className="divide-y divide-panel-border border-t border-panel-border px-5">
                {s.domains.map((d) => (
                  <SiteLine key={d.host} host={d.host} site={sites[d.host]} />
                ))}
              </div>
            ) : null}

            {s.deploys.length ? (
              <table className="w-full text-[13px]">
                <caption className="border-t border-panel-border px-5 pb-1 pt-3 text-left text-[13px] font-medium text-panel-fg-secondary">
                  Son deploylar
                </caption>
                <tbody>
                  {s.deploys.map((d) => {
                    const tone: Tone = d.status === "done" ? "ok" : d.status === "error" ? "critical" : "warn";
                    return (
                      <tr key={d.id}>
                        <td className="w-32 py-1.5 pl-5 pr-4 align-top">
                          <Status tone={tone}>{tone === "ok" ? "Başarılı" : tone === "critical" ? "Başarısız" : "Sürüyor"}</Status>
                        </td>
                        <td className="max-w-0 truncate py-1.5 pr-4 text-panel-fg">{d.status === "error" && d.error ? d.error : d.title}</td>
                        <td className="w-36 py-1.5 pr-5 text-right tabular-nums text-panel-fg-secondary">{fmtDateTime(d.at)}</td>
                      </tr>
                    );
                  })}
                  <tr aria-hidden>
                    <td className="pb-2" colSpan={3} />
                  </tr>
                </tbody>
              </table>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}

function MetaForm({ serverKey, meta, onClose, onSaved }: { serverKey: string; meta: ServerMeta; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    purchasedAt: meta.purchasedAt ?? "",
    provider: meta.provider ?? "",
    monthlyCost: meta.monthlyCost?.toString() ?? "",
    currency: meta.currency,
    renewalDay: meta.renewalDay?.toString() ?? "",
    note: meta.note ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const r = await post({ op: "meta", key: serverKey, meta: form });
    setSaving(false);
    if (!r.ok) return setError(String(r.data.error ?? "Kaydedilemedi"));
    onSaved();
  }

  return (
    <form onSubmit={save} className="grid gap-4 border-t border-panel-border px-5 py-4 sm:grid-cols-2 lg:grid-cols-5">
      <label className={LABEL}>
        Satın alma tarihi
        <input type="date" value={form.purchasedAt} onChange={set("purchasedAt")} className={`${FIELD} mt-1`} />
      </label>
      <label className={LABEL}>
        Sağlayıcı
        <input value={form.provider} onChange={set("provider")} placeholder="Hetzner, Contabo" className={`${FIELD} mt-1`} />
      </label>
      <label className={LABEL}>
        Aylık ücret
        <span className="mt-1 flex gap-2">
          <input type="number" min="0" step="0.01" value={form.monthlyCost} onChange={set("monthlyCost")} className={FIELD} />
          <select value={form.currency} onChange={set("currency")} className={`${FIELD} w-24`} aria-label="Para birimi">
            {["USD", "EUR", "TRY"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </span>
      </label>
      <label className={LABEL}>
        Ödeme günü (ayın kaçı)
        <input type="number" min="1" max="31" value={form.renewalDay} onChange={set("renewalDay")} className={`${FIELD} mt-1`} />
      </label>
      <label className={LABEL}>
        Not
        <input value={form.note} onChange={set("note")} className={`${FIELD} mt-1`} />
      </label>
      <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-5 lg:justify-end">
        {error ? <p className="mr-auto text-[13px] text-panel-critical">{error}</p> : null}
        <button type="button" onClick={onClose} className={BTN_QUIET}>
          Vazgeç
        </button>
        <button type="submit" disabled={saving} className={BTN_SOLID}>
          {saving ? "Kaydediliyor…" : "Kaydet"}
        </button>
      </div>
    </form>
  );
}

type DockerDiskItem = { type: string; sizeBytes: number; reclaimable: string | null; active: number | null; total: number | null };

const DISK_TYPE_COLOR: Record<string, string> = {
  Images: "#0866FF",
  Containers: "#0F766E",
  "Local Volumes": "#7C3AED",
  "Build Cache": "#E37400",
};

const DISK_TYPE_LABEL: Record<string, string> = {
  Images: "İmajlar",
  Containers: "Container'lar",
  "Local Volumes": "Volume'lar",
  "Build Cache": "Build cache",
};

function gb(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

/** Docker'ın diskte kapladığı yer — büyükten küçüğe, tek renk çubuk. */
function DockerDisk({ items }: { items: DockerDiskItem[] }) {
  const sorted = [...items].sort((a, b) => b.sizeBytes - a.sizeBytes);
  const max = sorted[0]?.sizeBytes || 1;
  const total = sorted.reduce((n, i) => n + i.sizeBytes, 0);
  return (
    <div className="border-b border-panel-border px-5 py-4">
      <h3 className="text-[15px] font-semibold text-panel-fg">
        Docker şu an <span className="tabular-nums">{gb(total)}</span> yer kaplıyor
      </h3>
      <ul className="mt-3 space-y-2">
        {sorted.map((i) => (
          <li key={i.type} className="grid grid-cols-[7rem_1fr] items-center gap-x-4 text-[13px] sm:grid-cols-[7rem_1fr_16rem]">
            <span className="text-panel-fg">{DISK_TYPE_LABEL[i.type] ?? i.type}</span>
            <span className="flex items-center gap-3">
              <span
                className="h-2.5 rounded-full"
                style={{ width: `${Math.max(0.5, (i.sizeBytes / max) * 100)}%`, background: DISK_TYPE_COLOR[i.type] ?? "#71717a" }}
              />
              <span className="shrink-0 font-semibold tabular-nums text-panel-fg">{gb(i.sizeBytes)}</span>
            </span>
            <span className="col-span-2 text-panel-fg-secondary sm:col-span-1 sm:text-right">
              {[i.reclaimable ? `${i.reclaimable} geri kazanılabilir` : null, i.active != null && i.total != null ? `${i.active}/${i.total} kullanımda` : null]
                .filter(Boolean)
                .join(", ")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Disk dökümü yavaş bir sorgudur (docker system df) — sekme açılınca ayrıca yüklenir. */
function DockerDiskLoader({ serverKey, version }: { serverKey: string; version: number }) {
  const [state, setState] = useState<{ key: string; items: DockerDiskItem[] | null } | null>(null);
  const id = `${serverKey}#${version}`;
  useEffect(() => {
    let alive = true;
    post({ op: "dockerDisk", key: serverKey }).then((r) => {
      if (alive) setState({ key: id, items: (r.data.items as DockerDiskItem[] | null) ?? null });
    });
    return () => {
      alive = false;
    };
  }, [serverKey, id]);
  if (state?.key !== id) {
    return <p className="border-b border-panel-border px-5 py-4 text-[13px] text-panel-fg-secondary">Docker disk kullanımı hesaplanıyor…</p>;
  }
  return state.items ? <DockerDisk items={state.items} /> : null;
}

const VIEWS = [
  { key: "projeler", label: "Projeler" },
  { key: "grafikler", label: "Grafikler" },
  { key: "temizlik", label: "Docker temizliği" },
  { key: "olaylar", label: "Olaylar" },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

const EVENT_TONE: Record<string, Tone> = { info: "unknown", warn: "warn", critical: "critical" };
const HEALTH_LABEL: Record<Tone, string> = { ok: "Sağlıklı", warn: "Uyarı var", critical: "Sorun var", unknown: "Ölçüm yok" };

/* ───────── ana bileşen ───────── */

export default function ServerDashboard({ data, hosting }: { data: ServerPageData; hosting: HostingRow[] | null }) {
  const searchParams = useSearchParams();
  const viewParam = searchParams.get("v");
  const projectId = searchParams.get("p");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: Tone; text: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [diskVersion, setDiskVersion] = useState(0);
  const refresh = () => startTransition(() => router.refresh());

  if (!data.configured) {
    return (
      <section className={`${FRAME} px-5 py-6`}>
        <h2 className="text-xl font-semibold tracking-tight text-panel-fg">Dokploy bağlantısı kurulmadı</h2>
        <p className="mt-1 text-[13px] text-panel-fg-secondary">Sunucuları ve projeleri okuyabilmek için Dokploy API anahtarı gerekiyor.</p>
        <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-[13px] text-panel-fg">
          <li>Dokploy&apos;da Profile sayfasındaki API/CLI Keys bölümünden anahtar üret.</li>
          <li>
            Panelin ortam değişkenlerine <code>DOKPLOY_URL</code>, <code>DOKPLOY_API_KEY</code> ve <code>DOKPLOY_NAME</code> ekle.
          </li>
          <li>
            İkinci sunucu için <code>DOKPLOY_2_URL</code>, <code>DOKPLOY_2_API_KEY</code> ve <code>DOKPLOY_2_NAME</code> ekle.
          </li>
          <li>Paneli yeniden deploy et.</li>
        </ol>
      </section>
    );
  }

  const sel = data.selected;
  const view: ViewKey = VIEWS.some((v) => v.key === viewParam) ? (viewParam as ViewKey) : "projeler";
  const project = sel?.projects.find((p) => p.id === projectId) ?? null;
  const colors = colorMap(sel?.projects ?? []);
  /** Sayfa içi bağlantı: verilmeyen parametreler mevcut değerini korur. */
  const link = (key: string, o: { range?: RangeKey; v?: ViewKey; p?: string | null } = {}) => {
    const q = new URLSearchParams({ s: key });
    const range = o.range ?? sel?.range ?? "24h";
    const v = o.v ?? view;
    if (range !== "24h") q.set("range", range);
    if (v !== "projeler") q.set("v", v);
    if (o.p) q.set("p", o.p);
    return `/sunucular?${q}`;
  };

  async function refreshNow() {
    setBusy("refresh");
    setNotice(null);
    const r = await post({ op: "refresh" });
    setBusy(null);
    const errors = (r.data.errors as string[] | undefined) ?? [];
    setNotice(
      !r.ok
        ? { tone: "critical", text: String(r.data.error ?? "Yenilenemedi") }
        : errors.length
          ? { tone: "warn", text: `Ölçüm alındı, bazı adımlar başarısız: ${errors.join("; ")}` }
          : { tone: "ok", text: "Ölçüm ve site kontrolleri yenilendi." },
    );
    refresh();
  }

  async function cleanup(action: CleanupAction) {
    if (!sel) return;
    const spec = CLEANUP_ACTIONS[action];
    const ok = confirm(`${sel.server.name}: ${spec.label} temizlensin mi?\n\n${spec.hint}${spec.danger ? "\n\nBu işlem geri alınamaz." : ""}`);
    if (!ok) return;
    if (spec.danger && prompt('Onaylamak için "SİL" yaz:') !== "SİL") return;
    setBusy(`cleanup:${action}`);
    setNotice(null);
    const r = await post({ op: "cleanup", key: sel.server.key, action });
    setBusy(null);
    setDiskVersion((v) => v + 1);
    if (!r.ok) {
      setNotice({ tone: "critical", text: String(r.data.error ?? "Temizlik başarısız") });
    } else {
      const before = r.data.before as number | null;
      const after = r.data.after as number | null;
      setNotice({
        tone: "ok",
        text:
          before != null && after != null
            ? `${spec.label} temizlendi. Disk ${pct(before, 1)} iken ${pct(after, 1)} oldu.`
            : `${spec.label} temizlendi.`,
      });
    }
    refresh();
  }

  async function toggleAuto(enabled: boolean) {
    if (!sel) return;
    setBusy("auto");
    const r = await post({ op: "autoCleanup", key: sel.server.key, enabled });
    setBusy(null);
    if (!r.ok) setNotice({ tone: "critical", text: String(r.data.error ?? "Ayar değiştirilemedi") });
    refresh();
  }

  const m = sel?.live?.metric ?? null;
  const overall: Tone = sel
    ? sel.instanceError || (sel.live && !sel.live.up)
      ? "critical"
      : (data.tabs.find((t) => t.key === sel.server.key)?.health ?? "unknown")
    : "unknown";
  const opened = sel ? (sel.meta.purchasedAt ?? sel.server.addedAt) : null;
  const openEvents = sel?.events.filter((e) => !e.resolvedAt).length ?? 0;
  const dueCount = hosting?.filter((h) => !h.hidden && h.daysLeft <= 0).length ?? 0;
  const topTab = (active: boolean) =>
    `flex min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-lg px-4 py-2.5 transition-colors sm:flex-none sm:min-w-44 ${
      active ? "bg-[#e91825] text-white" : "text-panel-fg hover:bg-[#e91825]/10"
    }`;

  return (
    <div className="space-y-4">
      {data.mock ? (
        <p className="rounded-md border border-panel-warn-border bg-panel-warn-bg px-4 py-2 text-[13px] text-panel-warn">
          Örnek veri kipi (DOKPLOY_MOCK=1): gösterilen sunucu ve projeler gerçek değil.
        </p>
      ) : null}

      {/* Üst sekmeler: hosting + sunucular */}
      <nav className={`${FRAME} flex flex-wrap gap-1 p-1.5`} aria-label="Sunucu yönetimi">
        <Link href="/sunucular?s=hosting" aria-current={hosting ? "page" : undefined} className={topTab(Boolean(hosting))}>
          <span className="text-[15px] font-semibold">Hosting takibi</span>
          <span className={`text-[13px] ${hosting ? "text-white/85" : "text-panel-fg-secondary"}`}>
            {hosting && dueCount ? `${dueCount} firmanın süresi doldu` : "Yıllık yenilemeler"}
          </span>
        </Link>
        {data.tabs.map((t) => {
          const active = !hosting && t.key === sel?.server.key;
          return (
            <Link key={t.key} href={`/sunucular?s=${encodeURIComponent(t.key)}`} aria-current={active ? "page" : undefined} className={topTab(active)}>
              <span className="text-[15px] font-semibold">{t.name}</span>
              <Status tone={t.health} onColor={active} className="self-start">
                {t.openEvents ? `${t.openEvents} açık uyarı` : t.diskPct != null ? `Disk ${pct(t.diskPct)}` : HEALTH_LABEL[t.health]}
              </Status>
            </Link>
          );
        })}
      </nav>

      {notice ? (
        <p role="status" className={`${FRAME} px-5 py-3`}>
          <Status tone={notice.tone}>{notice.text}</Status>
        </p>
      ) : null}

      {hosting ? (
        <HostingTracker rows={hosting} />
      ) : !sel ? (
        <p className={`${FRAME} px-5 py-6 text-[13px] text-panel-fg-secondary`}>Dokploy&apos;dan sunucu bilgisi alınamadı.</p>
      ) : project ? (
        <ProjectDetail
          project={project}
          sites={sel.sites}
          serverName={sel.server.name}
          backHref={link(sel.server.key, { p: null })}
          color={colors.get(project.id) ?? "#0866FF"}
        />
      ) : (
        <section className={FRAME}>
          {/* Başlık */}
          <header className="flex flex-wrap items-start justify-between gap-4 px-5 py-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <h2 className="text-xl font-semibold tracking-tight text-panel-fg">{sel.server.name}</h2>
                <Status tone={overall}>{HEALTH_LABEL[overall]}</Status>
              </div>
              <p className="mt-1 text-[13px] tabular-nums text-panel-fg-secondary">
                {[
                  sel.server.ip,
                  m?.os,
                  m?.cpuCores ? `${m.cpuCores} çekirdek` : null,
                  m?.memTotalGb ? `${m.memTotalGb.toFixed(0)} GB RAM` : null,
                  m?.diskTotalGb ? `${m.diskTotalGb.toFixed(0)} GB disk` : null,
                  sel.server.dokployVersion ? `Dokploy ${sel.server.dokployVersion}` : null,
                ]
                  .filter(Boolean)
                  .join(", ") || "Sunucu bilgisi alınamadı"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={refreshNow} disabled={busy !== null || pending} className={BTN}>
                <RefreshCw className={`size-4 ${busy === "refresh" ? "animate-spin" : ""}`} aria-hidden />
                {busy === "refresh" ? "Ölçülüyor…" : "Şimdi yenile"}
              </button>
              <button type="button" onClick={() => setEditing((v) => !v)} aria-expanded={editing} className={BTN}>
                Bilgileri düzenle
              </button>
              <a href={sel.server.dokployUrl} target="_blank" rel="noreferrer" className={BTN}>
                Dokploy&apos;u aç
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            </div>
          </header>

          {editing ? (
            <MetaForm
              serverKey={sel.server.key}
              meta={sel.meta}
              onClose={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                refresh();
              }}
            />
          ) : null}

          {sel.instanceError ? (
            <p role="alert" className="border-t border-panel-border bg-panel-critical-bg px-5 py-3 text-[13px] text-panel-critical">
              {sel.instanceError}
            </p>
          ) : null}

          {/* Göstergeler */}
          {sel.live?.source == null && !sel.instanceError ? (
            <p className="border-t border-panel-border bg-panel-warn-bg px-5 py-3 text-[13px] text-panel-warn">
              CPU, RAM ve disk henüz okunamadı. Bir iki dakika sonra &quot;Şimdi yenile&quot;ye bas; yine gelmezse Dokploy bu sunucu
              için ölçüm vermiyor demektir. Projeler, site kontrolleri ve Docker temizliği bundan etkilenmez.
            </p>
          ) : (
            <div className="grid gap-3 border-t border-panel-border p-4 sm:grid-cols-3">
              <Meter color="#0866FF" label="CPU" value={m?.cpuPct} tone={loadTone(m?.cpuPct, 85, 95)} sub={m?.cpuModel} />
              <Meter
                color="#7C3AED"
                label="RAM"
                value={m?.memPct}
                tone={loadTone(m?.memPct, 85, 95)}
                sub={m?.memPct != null && m.memTotalGb ? `${((m.memPct / 100) * m.memTotalGb).toFixed(1)} / ${m.memTotalGb.toFixed(1)} GB` : null}
              />
              <Meter
                color="#0F766E"
                label="Disk"
                value={m?.diskPct}
                tone={loadTone(m?.diskPct, DISK_WARN_PCT, DISK_CRITICAL_PCT)}
                sub={
                  <>
                    {m?.diskPct != null && m.diskTotalGb ? `${((m.diskPct / 100) * m.diskTotalGb).toFixed(0)} / ${m.diskTotalGb.toFixed(0)} GB` : null}
                    {sel.diskFullInDays != null ? (
                      <span className="font-semibold text-white">, bu hızla {sel.diskFullInDays} günde dolar</span>
                    ) : null}
                  </>
                }
              />
            </div>
          )}
          {sel.live && !sel.live.up ? (
            <p role="alert" className="border-t border-panel-border bg-panel-critical-bg px-5 py-3 text-[13px] text-panel-critical">
              Son ölçüm alınamadı: {sel.live.error ?? "bilinmeyen hata"}
            </p>
          ) : null}

          {/* Bilgi satırı */}
          <dl className="grid grid-cols-2 border-t border-panel-border sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-panel-border">
            <Fact
              label="Açılış tarihi"
              value={fmtDate(opened)}
              hint={opened ? `${age(opened)} önce${sel.meta.provider ? `, ${sel.meta.provider}` : ""}` : "Bilgileri düzenle ile gir"}
            />
            <Fact label="Kesintisiz çalışma" value={duration(m?.uptimeSec)} />
            <Fact
              label={`Erişilebilirlik, ${RANGES[sel.range].label}`}
              value={pct(sel.uptimePct, 2)}
              hint={sel.sampleCount ? `${sel.sampleCount} ölçüm` : "henüz ölçüm yok"}
            />
            <Fact
              label="Aylık ücret"
              value={sel.meta.monthlyCost != null ? `${sel.meta.monthlyCost.toLocaleString("tr-TR")} ${sel.meta.currency}` : "—"}
              hint={sel.meta.note}
            />
            <Fact label="Sonraki ödeme" value={fmtDate(sel.meta.nextRenewal)} />
          </dl>

          {/* Bölüm sekmeleri */}
          <nav className="flex gap-1 overflow-x-auto border-t border-panel-border px-3" aria-label="Bölümler">
            {VIEWS.map((v) => {
              const active = v.key === view;
              const count = v.key === "projeler" ? sel.projects.length : v.key === "olaylar" ? openEvents : 0;
              return (
                <SoftLink
                  key={v.key}
                  href={link(sel.server.key, { v: v.key })}
                  aria-current={active ? "page" : undefined}
                  className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-[13px] font-semibold transition-colors ${
                    active ? "border-[#e91825] text-[#e91825]" : "border-transparent text-panel-fg-secondary hover:text-panel-fg"
                  }`}
                >
                  {v.label}
                  {count ? (
                    <span
                      className={`rounded-full px-1.5 text-[12px] tabular-nums ${
                        v.key === "olaylar" ? "bg-rose-600 text-white" : "bg-[#0866FF] text-white"
                      }`}
                    >
                      {count}
                    </span>
                  ) : null}
                </SoftLink>
              );
            })}
          </nav>

          {view === "projeler" ? (
            sel.projects.length === 0 ? (
              <p className="border-t border-panel-border px-5 py-8 text-[13px] text-panel-fg-secondary">Bu sunucuda Dokploy projesi bulunamadı.</p>
            ) : (
              <div className="border-t border-panel-border p-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {sel.projects.map((p) => (
                    <ProjectCell
                      key={p.id}
                      project={p}
                      sites={sel.sites}
                      href={link(sel.server.key, { p: p.id })}
                      color={colors.get(p.id) ?? "#0866FF"}
                    />
                  ))}
                </div>
              </div>
            )
          ) : null}

          {view === "grafikler" ? (
            <div className="border-t border-panel-border">
              <div className="flex items-center justify-between gap-3 border-b border-panel-border px-5 py-3">
                <h3 className="text-[15px] font-semibold text-panel-fg">Geçmiş</h3>
                <div className="flex overflow-hidden rounded-md border border-panel-border-strong" role="group" aria-label="Zaman aralığı">
                  {(Object.keys(RANGES) as RangeKey[]).map((r) => (
                    <Link
                      key={r}
                      href={link(sel.server.key, { range: r })}
                      scroll={false}
                      aria-current={r === sel.range ? "true" : undefined}
                      className={`border-l border-panel-border-strong px-3 py-1.5 text-[13px] font-semibold first:border-l-0 ${
                        r === sel.range ? "bg-[#e91825] text-white" : "text-panel-fg-secondary hover:text-panel-fg"
                      }`}
                    >
                      {RANGES[r].label}
                    </Link>
                  ))}
                </div>
              </div>
              <ServerCharts data={sel.series} range={sel.range} diskWarnPct={DISK_WARN_PCT} />
            </div>
          ) : null}

          {view === "temizlik" ? (
            <div className="border-t border-panel-border">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-panel-border px-5 py-3">
                <p className="max-w-2xl text-[13px] text-panel-fg-secondary">
                  Disk dolduğunda yer açar. İşlem sunucuda Dokploy üzerinden çalışır, birkaç dakika sürebilir ve işlem kaydına yazılır.
                </p>
                {sel.server.dockerCleanup != null ? (
                  <label className="flex items-center gap-2 text-[13px] font-medium text-panel-fg">
                    <input
                      type="checkbox"
                      className="size-4 accent-[#e91825]"
                      checked={sel.server.dockerCleanup}
                      disabled={busy !== null}
                      onChange={(e) => toggleAuto(e.target.checked)}
                    />
                    Her gün otomatik temizle
                  </label>
                ) : null}
              </div>
              {sel.server.serverId || data.mock ? null : <DockerDiskLoader serverKey={sel.server.key} version={diskVersion} />}
              <ul className="divide-y divide-panel-border">
                {(Object.keys(CLEANUP_ACTIONS) as CleanupAction[]).map((a) => {
                  const spec = CLEANUP_ACTIONS[a];
                  return (
                    <li key={a} className="grid items-center gap-x-6 gap-y-2 px-5 py-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto]">
                      <h3 className={`text-[15px] font-semibold ${spec.danger ? "text-panel-critical" : "text-panel-fg"}`}>{spec.label}</h3>
                      <p className="text-[13px] leading-5 text-panel-fg-secondary">{spec.hint}</p>
                      <button
                        type="button"
                        onClick={() => cleanup(a)}
                        disabled={busy !== null || Boolean(sel.instanceError)}
                        className={`${BTN} ${spec.danger ? "text-panel-critical hover:border-panel-critical" : ""}`}
                      >
                        {busy === `cleanup:${a}` ? "Temizleniyor…" : "Temizle"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {view === "olaylar" ? (
            sel.events.length === 0 ? (
              <p className="border-t border-panel-border px-5 py-8 text-[13px] text-panel-fg-secondary">
                Henüz kayıtlı olay yok. Kesinti, disk, SSL, deploy ve hosting uyarıları burada listelenir ve adminlere WhatsApp ile gider.
              </p>
            ) : (
              <table className="w-full border-t border-panel-border text-[13px]">
                <tbody className="divide-y divide-panel-border">
                  {sel.events.map((e) => {
                    const open = !e.resolvedAt;
                    return (
                      <tr key={e.id}>
                        <td className="w-28 py-2.5 pl-5 pr-4 align-top">
                          <Status tone={open ? (EVENT_TONE[e.severity] ?? "unknown") : e.kind === "cleanup" ? "unknown" : "ok"}>
                            {open ? "Açık" : e.kind === "cleanup" ? "İşlem" : "Çözüldü"}
                          </Status>
                        </td>
                        <td className="py-2.5 pr-4">
                          <span className="font-semibold text-panel-fg">{e.title}</span>
                          {e.detail ? <span className="block text-panel-fg-secondary">{e.detail}</span> : null}
                        </td>
                        <td className="w-44 py-2.5 pr-5 text-right align-top tabular-nums text-panel-fg-secondary">
                          {fmtDateTime(e.at)}
                          {e.resolvedAt && e.kind !== "cleanup" ? <span className="block">çözüldü {fmtDateTime(e.resolvedAt)}</span> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          ) : null}
        </section>
      )}
    </div>
  );
}
