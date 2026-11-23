"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  Film,
  Loader2,
  RefreshCw,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { btnSecondary, chipClass, fieldClass } from "@/components/panel/ds/buttons";
import {
  FORMAT_LABEL,
  PUBLISH_STATUS_LABEL,
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABEL,
  type SocialPlatformKey,
} from "@/lib/social/formats";
import type {
  AccountMatrixRow,
  HealthItem,
  HealthLevel,
  SocialCounts,
  TargetRow,
} from "@/lib/social/overview";

const PLATFORM_COLOR: Record<SocialPlatformKey, string> = {
  instagram: "#E1306C",
  facebook: "#0866FF",
  tiktok: "#111111",
  youtube: "#FF0000",
};

const LEVEL_STYLE: Record<HealthLevel, { box: string; icon: typeof CheckCircle2; tone: string }> = {
  ok: { box: "border-emerald-200 bg-emerald-50/60", icon: CheckCircle2, tone: "text-emerald-700" },
  warn: { box: "border-amber-200 bg-amber-50/60", icon: AlertTriangle, tone: "text-amber-700" },
  error: { box: "border-rose-200 bg-rose-50/70", icon: XCircle, tone: "text-rose-700" },
};

const STATUS_CLASS: Record<TargetRow["status"], string> = {
  pending: "bg-sky-50 text-sky-800",
  publishing: "bg-amber-50 text-amber-900",
  published: "bg-emerald-50 text-emerald-800",
  failed: "bg-rose-50 text-rose-800",
};

type Tab = "upcoming" | "published" | "failed";
const TAB_LABEL: Record<Tab, string> = {
  upcoming: "Yaklaşan",
  published: "Paylaşılan (30 gün)",
  failed: "Hatalı",
};

function fmt(iso: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function takvimHref(r: TargetRow): string {
  return `/takvim?post=${r.postId}`;
}

export default function SocialPublishingDashboard({
  health,
  counts,
  targets,
  matrix,
  canEdit,
}: {
  health: HealthItem[];
  counts: SocialCounts;
  targets: TargetRow[];
  matrix: AccountMatrixRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [tab, setTab] = useState<Tab>(counts.failed > 0 ? "failed" : "upcoming");
  const [tenantId, setTenantId] = useState("");
  const [platform, setPlatform] = useState<SocialPlatformKey | "">("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyMissing, setOnlyMissing] = useState(false);

  const refresh = () => startRefresh(() => router.refresh());

  // Paylaşım sürerken liste kendini yeniler.
  const inFlight = targets.some((t) => t.status === "publishing");
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => startRefresh(() => router.refresh()), 8000);
    return () => clearInterval(t);
  }, [inFlight, router]);

  const tenants = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of targets) m.set(t.tenantId, t.tenantName);
    return [...m].sort((a, b) => a[1].localeCompare(b[1], "tr"));
  }, [targets]);

  const filtered = useMemo(() => {
    const rows = targets.filter(
      (t) =>
        (!tenantId || t.tenantId === tenantId) &&
        (!platform || t.platform === platform) &&
        (tab === "upcoming"
          ? t.status === "pending" || t.status === "publishing"
          : tab === "published"
            ? t.status === "published"
            : t.status === "failed"),
    );
    return rows.sort((a, b) =>
      tab === "upcoming"
        ? a.scheduledAt.localeCompare(b.scheduledAt)
        : (b.publishedAt ?? b.scheduledAt).localeCompare(a.publishedAt ?? a.scheduledAt),
    );
  }, [targets, tenantId, platform, tab]);

  const tabCount = (t: Tab) =>
    targets.filter((r) =>
      t === "upcoming"
        ? r.status === "pending" || r.status === "publishing"
        : t === "published"
          ? r.status === "published"
          : r.status === "failed",
    ).length;

  async function retry(r: TargetRow) {
    setBusy(r.id);
    setError(null);
    try {
      const res = await fetch(`/api/panel/content-posts/${r.postId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry", platforms: [r.platform] }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error || "Tekrar denenemedi");
      await new Promise((ok) => setTimeout(ok, 800));
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tekrar denenemedi");
    } finally {
      setBusy(null);
    }
  }

  const matrixRows = onlyMissing
    ? matrix.filter((m) => !m.accounts.instagram || !m.accounts.facebook)
    : matrix;

  return (
    <div className="space-y-6">
      {/* ── sistem durumu ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-[#141111]">Sistem durumu</h2>
          <button type="button" className={`${btnSecondary} !min-h-9`} onClick={refresh} disabled={refreshing}>
            {refreshing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
            Yenile
          </button>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {health.map((h) => {
            const s = LEVEL_STYLE[h.level];
            const Icon = s.icon;
            return (
              <li key={h.key} className={`rounded-xl border p-4 ${s.box}`}>
                <div className="flex items-center gap-2">
                  <Icon className={`size-4 shrink-0 ${s.tone}`} aria-hidden />
                  <p className="text-sm font-semibold text-[#141111]">{h.label}</p>
                </div>
                <p className={`mt-1.5 text-sm ${s.tone}`}>{h.summary}</p>
                {h.detail ? <p className="mt-1 break-words text-xs text-zinc-600">{h.detail}</p> : null}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── sayaçlar ── */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Sırada (otomatik)", value: counts.queued },
          { label: "Bugün paylaşılacak", value: counts.dueToday },
          { label: "Son 7 günde paylaşılan", value: counts.published7d },
          { label: "Hatalı", value: counts.failed, alert: counts.failed > 0 },
        ].map((c) => (
          <div
            key={c.label}
            className={`rounded-xl border p-4 ${c.alert ? "border-rose-200 bg-rose-50/60" : "border-zinc-200 bg-white"}`}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">{c.label}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${c.alert ? "text-rose-700" : "text-[#141111]"}`}>
              {c.value}
            </p>
          </div>
        ))}
      </section>

      {/* ── paylaşımlar ── */}
      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
            <button key={t} type="button" className={chipClass(tab === t)} onClick={() => setTab(t)}>
              {TAB_LABEL[t]}
              <span className="tabular-nums opacity-70">{tabCount(t)}</span>
            </button>
          ))}
          <div className="ml-auto flex flex-wrap gap-2">
            <select className={`${fieldClass} !min-h-9 text-sm`} value={tenantId} onChange={(e) => setTenantId(e.target.value)} aria-label="Marka">
              <option value="">Tüm markalar</option>
              {tenants.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <select
              className={`${fieldClass} !min-h-9 text-sm`}
              value={platform}
              onChange={(e) => setPlatform(e.target.value as SocialPlatformKey | "")}
              aria-label="Platform"
            >
              <option value="">Tüm platformlar</option>
              {SOCIAL_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {SOCIAL_PLATFORM_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}

        {filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500">
            {tab === "upcoming"
              ? "Sırada paylaşım yok. Takvimde bir içeriği açıp “Otomatik paylaşım” bölümünden platform seçin."
              : tab === "published"
                ? "Son 30 günde paylaşım yok."
                : "Hatalı paylaşım yok."}
            {tab === "upcoming" ? (
              <div className="mt-3">
                <Link href="/takvim" className="font-semibold text-[#e91825] hover:underline">
                  Takvime git
                </Link>
              </div>
            ) : null}
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {filtered.map((r) => (
              <li key={r.id} className="flex gap-3 py-3">
                <Link
                  href={takvimHref(r)}
                  className="relative size-14 shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100"
                  aria-label="İçeriği takvimde aç"
                >
                  {r.thumb?.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.thumb.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : r.thumb?.kind === "video" ? (
                    <span className="flex h-full w-full items-center justify-center text-zinc-500">
                      <Film className="size-5" aria-hidden />
                    </span>
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-[10px] text-zinc-400">medya yok</span>
                  )}
                  {r.mediaCount > 1 ? (
                    <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 text-[10px] text-white">
                      {r.mediaCount}
                    </span>
                  ) : null}
                </Link>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#141111]"
                      title={r.account ?? undefined}
                    >
                      <span className="size-2.5 rounded-full" style={{ background: PLATFORM_COLOR[r.platform] }} aria-hidden />
                      {SOCIAL_PLATFORM_LABEL[r.platform]} · {FORMAT_LABEL[r.format]}
                    </span>
                    <span className="text-xs text-zinc-400">·</span>
                    <Link href={`/brands/${r.tenantSlug}#sosyal-hesaplar`} className="text-xs text-zinc-600 hover:underline">
                      {r.tenantName}
                    </Link>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[r.status]}`}>
                      {r.status === "publishing" ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
                      {PUBLISH_STATUS_LABEL[r.status]}
                    </span>
                    {r.status === "pending" && !r.autoPublish ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600"
                        title="İçerikte “Zamanı gelince otomatik paylaş” kapalı — yalnızca elle paylaşılır."
                      >
                        <CircleDashed className="size-3" aria-hidden />
                        Otomatik kapalı
                      </span>
                    ) : null}
                  </div>
                  <Link href={takvimHref(r)} className="mt-0.5 block truncate text-sm font-medium text-[#141111] hover:underline">
                    {r.postTitle || r.captionPreview || "Başlıksız içerik"}
                  </Link>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {r.status === "published" && r.publishedAt
                      ? `Paylaşıldı ${fmt(r.publishedAt)}`
                      : `Planlanan ${fmt(r.scheduledAt)}`}
                    {r.status === "pending" && r.nextAttemptAt ? ` · tekrar denenecek ${fmt(r.nextAttemptAt)}` : ""}
                    {r.attempts > 1 ? ` · ${r.attempts}. deneme` : ""}
                  </p>
                  {r.lastError && r.status !== "published" ? (
                    <p className="mt-1 flex items-start gap-1 break-words text-xs text-rose-700">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      {r.lastError}
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {r.permalink ? (
                    <a
                      href={r.permalink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#e91825] hover:underline"
                    >
                      <ExternalLink className="size-3.5" aria-hidden />
                      Aç
                    </a>
                  ) : null}
                  {canEdit && r.status === "failed" ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#141111] hover:underline disabled:opacity-50"
                      disabled={busy !== null}
                      onClick={() => void retry(r)}
                    >
                      {busy === r.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RotateCcw className="size-3.5" aria-hidden />}
                      Tekrar dene
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── hesaplar ── */}
      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-[#141111]">Bağlı hesaplar</h2>
            <p className="mt-0.5 text-sm text-zinc-500">Bağlamak için markaya tıklayın → Sosyal hesaplar.</p>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-zinc-600">
            <input type="checkbox" className="size-4 accent-[#e91825]" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
            Yalnızca Meta eksik olanlar
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                <th className="py-2 pr-3 font-medium">Marka</th>
                {SOCIAL_PLATFORMS.map((p) => (
                  <th key={p} className="px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ background: PLATFORM_COLOR[p] }} aria-hidden />
                      {SOCIAL_PLATFORM_LABEL[p]}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {matrixRows.map((m) => (
                <tr key={m.tenantId}>
                  <td className="py-2 pr-3">
                    <Link href={`/brands/${m.tenantSlug}#sosyal-hesaplar`} className="font-medium text-[#141111] hover:underline">
                      {m.tenantName}
                    </Link>
                    {!m.visible ? <span className="ml-1.5 text-xs text-zinc-400">(gizli)</span> : null}
                  </td>
                  {SOCIAL_PLATFORMS.map((p) => {
                    const a = m.accounts[p];
                    return (
                      <td key={p} className="px-3 py-2">
                        {a ? (
                          <span
                            className={`inline-flex max-w-[180px] items-center gap-1 truncate text-xs ${a.lastError ? "text-rose-700" : "text-emerald-700"}`}
                            title={a.lastError ?? a.label}
                          >
                            {a.lastError ? <AlertTriangle className="size-3.5 shrink-0" aria-hidden /> : <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />}
                            <span className="truncate">{a.label}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-300">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
