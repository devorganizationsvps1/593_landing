"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Database,
  ExternalLink,
  Layers,
  Package,
  Pencil,
  RefreshCw,
  Server,
  Trash2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btnGhost, btnPrimary, btnSecondary, chipClass, fieldClass } from "@/components/panel/ds/buttons";
import { DISK_CRITICAL_PCT, DISK_WARN_PCT } from "@/lib/servers/config";
import type { ServerMeta, ServerPageData, SiteStatus } from "@/lib/servers/queries";
import { CLEANUP_ACTIONS, RANGES, type CleanupAction, type ProjectInfo, type RangeKey, type ServiceInfo } from "@/lib/servers/types";
import { ServerCharts } from "./ServerCharts";

type Tone = "ok" | "warn" | "critical" | "unknown";

const TONE: Record<Tone, { Icon: LucideIcon; text: string; pill: string; bar: string }> = {
  ok: { Icon: CheckCircle2, text: "text-panel-ok", pill: "bg-panel-ok-bg text-panel-ok border-panel-ok/20", bar: "bg-panel-ok" },
  warn: { Icon: AlertTriangle, text: "text-panel-warn", pill: "bg-panel-warn-bg text-panel-warn border-panel-warn/25", bar: "bg-panel-warn" },
  critical: { Icon: XCircle, text: "text-panel-critical", pill: "bg-panel-critical-bg text-panel-critical border-panel-critical/25", bar: "bg-panel-critical" },
  unknown: { Icon: CircleHelp, text: "text-panel-unknown", pill: "bg-panel-unknown-bg text-panel-unknown border-panel-border-strong", bar: "bg-panel-border-strong" },
};

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const { Icon, pill } = TONE[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-semibold ${pill}`}>
      <Icon className="size-3.5 shrink-0" aria-hidden strokeWidth={2.25} />
      {children}
    </span>
  );
}

const TZ = "Europe/Istanbul";
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("tr-TR", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtDateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("tr-TR", { timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";
const pct = (v: number | null | undefined, d = 0) => (v == null ? "—" : `%${v.toFixed(d)}`);

function age(iso: string | null): string {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "bugün";
  if (days < 31) return `${days} gün`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} ay`;
  const years = Math.floor(months / 12);
  return months % 12 ? `${years} yıl ${months % 12} ay` : `${years} yıl`;
}

function duration(sec: number | null | undefined): string {
  if (sec == null) return "—";
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3600);
  return d > 0 ? `${d} gün ${h} sa` : `${h} sa ${Math.floor((sec % 3600) / 60)} dk`;
}

function loadTone(v: number | null | undefined, warn: number, critical: number): Tone {
  if (v == null) return "unknown";
  return v >= critical ? "critical" : v >= warn ? "warn" : "ok";
}

async function post(body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch("/api/panel/servers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  return { ok: res.ok, data };
}

/* ───────── parçalar ───────── */

function Meter({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: number | null | undefined;
  tone: Tone;
  sub?: React.ReactNode;
}) {
  const t = TONE[tone];
  const word = tone === "critical" ? "Kritik" : tone === "warn" ? "Yüksek" : tone === "ok" ? "Normal" : "Ölçüm yok";
  return (
    <div className="rounded-panel-lg border border-panel-border bg-panel-surface p-5 shadow-panel">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-panel-fg-secondary">{label}</span>
        <span className={`inline-flex items-center gap-1 text-xs font-semibold ${t.text}`}>
          <t.Icon className="size-3.5" aria-hidden />
          {word}
        </span>
      </div>
      <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-panel-fg">{pct(value, 1)}</p>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-panel-surface-muted"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value ?? undefined}
      >
        <div className={`h-full rounded-full ${t.bar}`} style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }} />
      </div>
      {sub ? <p className="mt-2 text-xs text-panel-fg-secondary">{sub}</p> : null}
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-panel-fg-muted">{label}</dt>
      <dd className="mt-1 truncate text-sm font-semibold text-panel-fg">{value}</dd>
      {hint ? <dd className="truncate text-xs text-panel-fg-secondary">{hint}</dd> : null}
    </div>
  );
}

const STATUS: Record<string, { tone: Tone; label: string }> = {
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

function KindIcon({ kind }: { kind: ServiceInfo["kind"] }) {
  const Icon = kind === "application" ? Package : kind === "compose" ? Layers : Database;
  return <Icon className="size-4 shrink-0 text-panel-fg-muted" aria-hidden />;
}

function SiteCell({ host, site }: { host: string; site: SiteStatus | undefined }) {
  const sslTone: Tone =
    site?.sslDaysLeft == null ? "unknown" : site.sslDaysLeft <= 3 ? "critical" : site.sslDaysLeft <= 14 ? "warn" : "ok";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <a
        href={`https://${host}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 font-medium text-panel-fg hover:underline"
      >
        {host}
        <ExternalLink className="size-3 text-panel-fg-muted" aria-hidden />
      </a>
      {site ? (
        <>
          <Pill tone={site.ok ? "ok" : "critical"}>
            {site.ok ? `${site.status ?? "OK"} · ${site.ms ?? "?"} ms` : site.error ?? "Açılmıyor"}
          </Pill>
          {site.uptime24h != null ? (
            <span className="text-xs tabular-nums text-panel-fg-secondary">24 sa erişim {pct(site.uptime24h, 1)}</span>
          ) : null}
          {site.sslDaysLeft != null ? (
            <span className={`text-xs tabular-nums ${sslTone === "ok" ? "text-panel-fg-secondary" : `font-semibold ${TONE[sslTone].text}`}`}>
              SSL {site.sslDaysLeft < 0 ? "süresi doldu" : `${site.sslDaysLeft} gün`}
            </span>
          ) : null}
        </>
      ) : (
        <span className="text-xs text-panel-fg-muted">henüz kontrol edilmedi</span>
      )}
    </div>
  );
}

function ProjectCard({ project, sites }: { project: ProjectInfo; sites: Record<string, SiteStatus> }) {
  return (
    <section className="rounded-panel-lg border border-panel-border bg-panel-surface shadow-panel">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-panel-border px-5 py-4">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-panel-fg">{project.name}</h3>
          {project.description ? <p className="truncate text-xs text-panel-fg-secondary">{project.description}</p> : null}
        </div>
        <p className="text-xs text-panel-fg-secondary">
          Açılış <span className="font-semibold text-panel-fg">{fmtDate(project.createdAt)}</span> · {age(project.createdAt)}
        </p>
      </header>
      <ul className="divide-y divide-panel-border">
        {project.services.map((s) => {
          const st = STATUS[s.status ?? ""] ?? { tone: "unknown" as Tone, label: s.status ?? "Bilinmiyor" };
          const last = s.deploys[0];
          return (
            <li key={`${s.kind}:${s.id}`} className="space-y-2 px-5 py-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <KindIcon kind={s.kind} />
                <span className="font-semibold text-panel-fg">{s.name}</span>
                <span className="text-xs text-panel-fg-muted">
                  {KIND_LABEL[s.kind]}
                  {s.environment ? ` · ${s.environment}` : ""}
                </span>
                <Pill tone={st.tone}>{st.label}</Pill>
                <span className="ml-auto text-xs text-panel-fg-secondary">
                  {s.partial ? "detay alınamadı" : `Açılış ${fmtDate(s.createdAt)} · ${age(s.createdAt)}`}
                </span>
              </div>
              {last ? (
                <p className="flex flex-wrap items-center gap-2 text-xs text-panel-fg-secondary">
                  <span>Son deploy {fmtDateTime(last.at)}</span>
                  <Pill tone={last.status === "done" ? "ok" : last.status === "error" ? "critical" : "warn"}>
                    {last.status === "done" ? "Başarılı" : last.status === "error" ? "Başarısız" : "Sürüyor"}
                  </Pill>
                  <span className="min-w-0 truncate">{last.status === "error" && last.error ? last.error : last.title}</span>
                </p>
              ) : null}
              {s.domains.map((d) => (
                <div key={d.host} className="text-sm">
                  <SiteCell host={d.host} site={sites[d.host]} />
                </div>
              ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function MetaForm({
  serverKey,
  meta,
  onClose,
  onSaved,
}: {
  serverKey: string;
  meta: ServerMeta;
  onClose: () => void;
  onSaved: () => void;
}) {
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
  const label = "block text-xs font-semibold text-panel-fg-secondary";

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
    <form onSubmit={save} className="mt-5 grid gap-4 border-t border-panel-border pt-5 sm:grid-cols-2 lg:grid-cols-3">
      <label className={label}>
        Satın alma tarihi
        <input type="date" value={form.purchasedAt} onChange={set("purchasedAt")} className={`${fieldClass} mt-1 w-full`} />
      </label>
      <label className={label}>
        Sağlayıcı
        <input value={form.provider} onChange={set("provider")} placeholder="Hetzner, Contabo…" className={`${fieldClass} mt-1 w-full`} />
      </label>
      <label className={label}>
        Aylık ücret
        <span className="mt-1 flex gap-2">
          <input type="number" min="0" step="0.01" value={form.monthlyCost} onChange={set("monthlyCost")} className={`${fieldClass} w-full`} />
          <select value={form.currency} onChange={set("currency")} className={fieldClass} aria-label="Para birimi">
            {["USD", "EUR", "TRY"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </span>
      </label>
      <label className={label}>
        Ödeme günü (ayın kaçı)
        <input type="number" min="1" max="31" value={form.renewalDay} onChange={set("renewalDay")} className={`${fieldClass} mt-1 w-full`} />
      </label>
      <label className={`${label} sm:col-span-2`}>
        Not
        <input value={form.note} onChange={set("note")} className={`${fieldClass} mt-1 w-full`} />
      </label>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3">
        <button type="submit" disabled={saving} className={btnPrimary}>
          {saving ? "Kaydediliyor…" : "Kaydet"}
        </button>
        <button type="button" onClick={onClose} className={btnGhost}>
          Vazgeç
        </button>
        {error ? <p className="text-sm text-panel-critical">{error}</p> : null}
      </div>
    </form>
  );
}

const EVENT_TONE: Record<string, Tone> = { info: "unknown", warn: "warn", critical: "critical" };

/* ───────── ana bileşen ───────── */

export default function ServerDashboard({ data }: { data: ServerPageData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: Tone; text: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const refresh = () => startTransition(() => router.refresh());

  if (!data.configured) {
    return (
      <section className="rounded-panel-lg border border-panel-border bg-panel-surface p-8 shadow-panel">
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-panel-accent-soft text-panel-accent">
            <Server className="size-5" aria-hidden />
          </span>
          <div className="space-y-3 text-sm text-panel-fg-secondary">
            <h2 className="text-base font-semibold text-panel-fg">Dokploy bağlantısı kurulmadı</h2>
            <p>Sunucuları ve projeleri okuyabilmek için Dokploy API anahtarı gerekiyor.</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Dokploy → Settings → Profile → API/CLI bölümünden anahtar üret.</li>
              <li>
                Panelin ortam değişkenlerine ekle: <code className="text-panel-fg">DOKPLOY_URL</code>,{" "}
                <code className="text-panel-fg">DOKPLOY_API_KEY</code>, <code className="text-panel-fg">DOKPLOY_NAME</code>.
              </li>
              <li>
                İkinci VPS&apos;te ayrı Dokploy varsa: <code className="text-panel-fg">DOKPLOY_2_URL</code>,{" "}
                <code className="text-panel-fg">DOKPLOY_2_API_KEY</code>, <code className="text-panel-fg">DOKPLOY_2_NAME</code>.
              </li>
              <li>Paneli yeniden deploy et.</li>
            </ol>
          </div>
        </div>
      </section>
    );
  }

  const sel = data.selected;
  const href = (key: string, range: RangeKey) => `/sunucular?s=${encodeURIComponent(key)}&range=${range}`;

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
          ? { tone: "warn", text: `Ölçüm alındı, bazı adımlar başarısız: ${errors.join(" · ")}` }
          : { tone: "ok", text: "Ölçüm ve site kontrolleri yenilendi." },
    );
    refresh();
  }

  async function cleanup(action: CleanupAction) {
    if (!sel) return;
    const spec = CLEANUP_ACTIONS[action];
    const ok = confirm(
      `${sel.server.name} — ${spec.label} temizlensin mi?\n\n${spec.hint}${spec.danger ? "\n\nBu işlem geri alınamaz." : ""}`,
    );
    if (!ok) return;
    if (spec.danger && prompt('Onaylamak için "SİL" yaz:') !== "SİL") return;
    setBusy(`cleanup:${action}`);
    setNotice(null);
    const r = await post({ op: "cleanup", key: sel.server.key, action });
    setBusy(null);
    if (!r.ok) {
      setNotice({ tone: "critical", text: String(r.data.error ?? "Temizlik başarısız") });
    } else {
      const before = r.data.before as number | null;
      const after = r.data.after as number | null;
      setNotice({
        tone: "ok",
        text:
          before != null && after != null
            ? `${spec.label} temizlendi. Disk ${pct(before, 1)} → ${pct(after, 1)}${
                Math.abs(before - after) < 0.05 ? " (ölçüm birkaç dakika içinde güncellenebilir)" : ""
              }`
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
  const overallLabel =
    overall === "critical" ? "Sorun var" : overall === "warn" ? "Uyarı var" : overall === "ok" ? "Sağlıklı" : "Ölçüm yok";
  const opened = sel ? (sel.meta.purchasedAt ?? sel.server.addedAt) : null;

  return (
    <div className="space-y-6">
      {data.mock ? (
        <p className="rounded-panel-md border border-panel-warn-border bg-panel-warn-bg px-4 py-2 text-sm text-panel-warn">
          Örnek veri kipi (DOKPLOY_MOCK=1) — gösterilen sunucu ve projeler gerçek değil.
        </p>
      ) : null}

      {/* Sunucu sekmeleri */}
      <nav className="flex flex-wrap gap-3" aria-label="Sunucular">
        {data.tabs.map((t) => {
          const active = t.key === sel?.server.key;
          const tone = TONE[t.health];
          return (
            <Link
              key={t.key}
              href={href(t.key, sel?.range ?? "24h")}
              aria-current={active ? "page" : undefined}
              className={`flex min-w-52 flex-1 items-center gap-3 rounded-panel-lg border px-4 py-3 transition sm:flex-none ${
                active
                  ? "border-panel-fg bg-panel-surface shadow-panel-md"
                  : "border-panel-border bg-panel-surface hover:border-panel-border-strong"
              }`}
            >
              <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl bg-panel-surface-muted ${tone.text}`}>
                <tone.Icon className="size-4.5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-panel-fg">{t.name}</span>
                <span className="block text-xs tabular-nums text-panel-fg-secondary">
                  Disk {pct(t.diskPct)}
                  {t.openEvents ? ` · ${t.openEvents} açık uyarı` : ""}
                </span>
              </span>
            </Link>
          );
        })}
      </nav>

      {notice ? (
        <p role="status" className={`rounded-panel-md border px-4 py-2 text-sm ${TONE[notice.tone].pill}`}>
          {notice.text}
        </p>
      ) : null}

      {sel ? (
        <>
          {sel.instanceError ? (
            <p className="rounded-panel-md border border-panel-critical-border bg-panel-critical-bg px-4 py-3 text-sm text-panel-critical">
              {sel.instanceError}
            </p>
          ) : null}

          {/* Özet */}
          <section className="rounded-panel-lg border border-panel-border bg-panel-surface p-6 shadow-panel">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-xl font-semibold tracking-tight text-panel-fg">{sel.server.name}</h2>
                  <Pill tone={overall}>{overallLabel}</Pill>
                </div>
                <p className="mt-1 text-sm text-panel-fg-secondary">
                  {[sel.server.ip, m?.os, m?.kernel, m?.cpuCores ? `${m.cpuCores} çekirdek` : null, m?.memTotalGb ? `${m.memTotalGb.toFixed(0)} GB RAM` : null, m?.diskTotalGb ? `${m.diskTotalGb.toFixed(0)} GB disk` : null]
                    .filter(Boolean)
                    .join(" · ") || "Sunucu bilgisi alınamadı"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={refreshNow} disabled={busy !== null || pending} className={btnSecondary}>
                  <RefreshCw className={`size-4 ${busy === "refresh" ? "animate-spin" : ""}`} aria-hidden />
                  {busy === "refresh" ? "Ölçülüyor…" : "Şimdi yenile"}
                </button>
                <button type="button" onClick={() => setEditing((v) => !v)} className={btnGhost}>
                  <Pencil className="size-4" aria-hidden />
                  Bilgileri düzenle
                </button>
                <a href={sel.server.dokployUrl} target="_blank" rel="noreferrer" className={btnGhost}>
                  <ExternalLink className="size-4" aria-hidden />
                  Dokploy
                </a>
              </div>
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
              <Fact
                label="Açılış tarihi"
                value={fmtDate(opened)}
                hint={opened ? (sel.meta.purchasedAt ? "satın alma" : "Dokploy'a eklenme") : "düzenleyerek gir"}
              />
              <Fact label="Yaş" value={age(opened)} hint={sel.meta.provider ?? undefined} />
              <Fact label="Kesintisiz çalışma" value={duration(m?.uptimeSec)} hint="son yeniden başlatmadan beri" />
              <Fact
                label={`Erişilebilirlik · ${RANGES[sel.range].label}`}
                value={pct(sel.uptimePct, 2)}
                hint={sel.sampleCount ? `${sel.sampleCount} ölçüm` : "ölçüm yok"}
              />
              <Fact
                label="Aylık ücret"
                value={sel.meta.monthlyCost != null ? `${sel.meta.monthlyCost.toLocaleString("tr-TR")} ${sel.meta.currency}` : "—"}
                hint={sel.meta.note ?? undefined}
              />
              <Fact label="Sonraki ödeme" value={fmtDate(sel.meta.nextRenewal)} hint={sel.server.dokployVersion ? `Dokploy ${sel.server.dokployVersion}` : undefined} />
            </dl>
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
          </section>

          {/* Anlık göstergeler */}
          {sel.live?.source == null && !sel.instanceError ? (
            <section className="rounded-panel-lg border border-panel-warn-border bg-panel-warn-bg p-5 text-sm text-panel-warn">
              <h3 className="font-semibold">Bu sunucuda kaynak ölçümü kapalı</h3>
              <p className="mt-1">
                CPU, RAM ve disk için Dokploy&apos;un Monitoring ajanı gerekiyor: Dokploy →{" "}
                {sel.server.serverId ? "Remote Servers → sunucu → Setup Server → Monitoring" : "Settings → Web Server → Monitoring"}{" "}
                bölümünden etkinleştir. Projeler, site ve SSL kontrolleri ile Docker temizliği ajan olmadan da çalışır.
              </p>
            </section>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <Meter label="CPU" value={m?.cpuPct} tone={loadTone(m?.cpuPct, 85, 95)} sub={m?.cpuModel ?? undefined} />
              <Meter
                label="RAM"
                value={m?.memPct}
                tone={loadTone(m?.memPct, 85, 95)}
                sub={m?.memPct != null && m.memTotalGb ? `${((m.memPct / 100) * m.memTotalGb).toFixed(1)} / ${m.memTotalGb.toFixed(1)} GB` : undefined}
              />
              <Meter
                label="Disk"
                value={m?.diskPct}
                tone={loadTone(m?.diskPct, DISK_WARN_PCT, DISK_CRITICAL_PCT)}
                sub={
                  <>
                    {m?.diskPct != null && m.diskTotalGb
                      ? `${((m.diskPct / 100) * m.diskTotalGb).toFixed(0)} / ${m.diskTotalGb.toFixed(0)} GB`
                      : null}
                    {sel.diskFullInDays != null ? (
                      <span className="font-semibold text-panel-warn"> · bu hızla ~{sel.diskFullInDays} günde dolar</span>
                    ) : null}
                  </>
                }
              />
            </div>
          )}
          {sel.live?.source === "local" ? (
            <p className="text-xs text-panel-fg-secondary">
              Panel bu sunucuda çalışıyor; ölçüm Dokploy ajanı olmadan doğrudan alınıyor (ağ trafiği hariç).
            </p>
          ) : null}
          {sel.live && !sel.live.up ? (
            <p className="rounded-panel-md border border-panel-critical-border bg-panel-critical-bg px-4 py-3 text-sm text-panel-critical">
              Son ölçüm alınamadı: {sel.live.error ?? "bilinmeyen hata"}
            </p>
          ) : null}

          {/* Geçmiş */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-panel-fg">Geçmiş</h2>
              <div className="flex gap-2" role="group" aria-label="Zaman aralığı">
                {(Object.keys(RANGES) as RangeKey[]).map((r) => (
                  <Link key={r} href={href(sel.server.key, r)} scroll={false} className={chipClass(r === sel.range)}>
                    {RANGES[r].label}
                  </Link>
                ))}
              </div>
            </div>
            <ServerCharts data={sel.series} range={sel.range} diskWarnPct={DISK_WARN_PCT} />
          </div>

          {/* Docker temizliği */}
          <section className="rounded-panel-lg border border-panel-border bg-panel-surface shadow-panel">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-panel-border px-6 py-5">
              <div className="max-w-2xl">
                <h2 className="text-base font-semibold text-panel-fg">Docker temizliği</h2>
                <p className="mt-1 text-sm text-panel-fg-secondary">
                  Disk dolduğunda yer açar. İşlem sunucuda Dokploy üzerinden çalışır, birkaç dakika sürebilir ve işlem kaydına yazılır.
                </p>
              </div>
              {sel.server.dockerCleanup != null ? (
                <label className="flex items-center gap-2 text-sm text-panel-fg">
                  <input
                    type="checkbox"
                    className="size-4 accent-[#141111]"
                    checked={sel.server.dockerCleanup}
                    disabled={busy !== null}
                    onChange={(e) => toggleAuto(e.target.checked)}
                  />
                  Günlük otomatik temizlik
                </label>
              ) : null}
            </header>
            <ul className="grid gap-px bg-panel-border sm:grid-cols-2 lg:grid-cols-3">
              {(Object.keys(CLEANUP_ACTIONS) as CleanupAction[]).map((a) => {
                const spec = CLEANUP_ACTIONS[a];
                const running = busy === `cleanup:${a}`;
                return (
                  <li key={a} className="flex flex-col gap-3 bg-panel-surface p-5">
                    <div>
                      <h3 className={`text-sm font-semibold ${spec.danger ? "text-panel-critical" : "text-panel-fg"}`}>{spec.label}</h3>
                      <p className="mt-1 text-xs leading-5 text-panel-fg-secondary">{spec.hint}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => cleanup(a)}
                      disabled={busy !== null || Boolean(sel.instanceError)}
                      className={`${spec.danger ? btnGhost : btnSecondary} mt-auto self-start ${spec.danger ? "text-panel-critical" : ""}`}
                    >
                      <Trash2 className="size-4" aria-hidden />
                      {running ? "Temizleniyor…" : "Temizle"}
                    </button>
                  </li>
                );
              })}
              {/* 5 kart: ızgaranın boş kalan hücresi kenarlık rengiyle dolmasın. */}
              <li aria-hidden className="hidden bg-panel-surface sm:block" />
            </ul>
          </section>

          {/* Projeler */}
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-panel-fg">
              Projeler <span className="font-normal text-panel-fg-secondary">· {sel.projects.length}</span>
            </h2>
            {sel.projects.length === 0 ? (
              <p className="rounded-panel-lg border border-panel-border bg-panel-surface p-6 text-sm text-panel-fg-secondary shadow-panel">
                Bu sunucuda Dokploy projesi bulunamadı.
              </p>
            ) : (
              sel.projects.map((p) => <ProjectCard key={p.id} project={p} sites={sel.sites} />)
            )}
          </div>

          {/* Olaylar */}
          <section className="rounded-panel-lg border border-panel-border bg-panel-surface shadow-panel">
            <header className="border-b border-panel-border px-6 py-5">
              <h2 className="text-base font-semibold text-panel-fg">Olaylar</h2>
              <p className="mt-1 text-sm text-panel-fg-secondary">
                Kesintiler, disk ve SSL uyarıları, başarısız deploylar ve temizlikler. Uyarılar adminlere WhatsApp ile de gider.
              </p>
            </header>
            {sel.events.length === 0 ? (
              <p className="px-6 py-6 text-sm text-panel-fg-secondary">Henüz kayıtlı olay yok.</p>
            ) : (
              <ul className="divide-y divide-panel-border">
                {sel.events.map((e) => {
                  const open = !e.resolvedAt;
                  return (
                    <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-6 py-3 text-sm">
                      <Pill tone={open ? (EVENT_TONE[e.severity] ?? "unknown") : e.kind === "cleanup" ? "unknown" : "ok"}>
                        {open ? "Açık" : e.kind === "cleanup" ? "İşlem" : "Çözüldü"}
                      </Pill>
                      <span className="font-medium text-panel-fg">{e.title}</span>
                      {e.detail ? <span className="min-w-0 truncate text-panel-fg-secondary">{e.detail}</span> : null}
                      <span className="ml-auto text-xs tabular-nums text-panel-fg-muted">
                        {fmtDateTime(e.at)}
                        {e.resolvedAt && e.kind !== "cleanup" ? ` → ${fmtDateTime(e.resolvedAt)}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      ) : (
        <p className="rounded-panel-lg border border-panel-border bg-panel-surface p-6 text-sm text-panel-fg-secondary shadow-panel">
          Dokploy&apos;dan sunucu bilgisi alınamadı.
        </p>
      )}
    </div>
  );
}
