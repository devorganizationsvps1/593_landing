"use client";

import { alertDialog, confirmDialog } from "@/components/panel/ds/confirm";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDashed,
  Clock,
  ExternalLink,
  Film,
  ImageOff,
  Link2,
  Info,
  Loader2,
  PencilLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import BulkMetaConnect from "@/components/panel/BulkMetaConnect";
import LinkCalendarPosts from "@/components/panel/LinkCalendarPosts";
import SocialComposer from "@/components/panel/SocialComposer";
import { toolChip, toolField, toolPrimary, toolSelect } from "@/components/panel/ds/buttons";
import { SocialIcon } from "@/components/panel/ds/social-icons";
import {
  FORMAT_LABEL,
  PUBLISHER_READY,
  PUBLISH_STATUS_LABEL,
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABEL,
  UNAPPROVED_NOTE,
  type SocialPlatformKey,
} from "@/lib/social/formats";
import type {
  AccountMatrixRow,
  HealthItem,
  HealthLevel,
  SocialCounts,
  TargetRow,
} from "@/lib/social/overview";

/* ───────────────────────── sabitler ───────────────────────── */

const TZ = "Europe/Istanbul";

type Tab = "upcoming" | "published" | "failed" | "draft" | "accounts";

/** Paylaşımı platformdan silmeyi destekleyen platformlar. */
const DELETABLE = new Set<SocialPlatformKey>(["instagram", "facebook"]);

const LEVEL_DOT: Record<HealthLevel, string> = {
  ok: "bg-emerald-500",
  info: "bg-zinc-300",
  warn: "bg-amber-500",
  error: "bg-rose-500",
};
const LEVEL_TEXT: Record<HealthLevel, string> = {
  ok: "text-zinc-600",
  info: "text-zinc-500",
  warn: "text-amber-800",
  error: "text-rose-700",
};

const STATUS_TONE: Record<TargetRow["status"], string> = {
  pending: "border-zinc-200 bg-white text-zinc-700",
  publishing: "border-amber-200 bg-amber-50 text-amber-900",
  published: "border-emerald-200 bg-emerald-50 text-emerald-800",
  failed: "border-rose-200 bg-rose-50 text-rose-700",
};

/* ───────────────────────── tarih yardımcıları ───────────────────────── */

const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dayLabelFmt = new Intl.DateTimeFormat("tr-TR", {
  timeZone: TZ,
  day: "numeric",
  month: "long",
  weekday: "long",
});
const shortFmt = new Intl.DateTimeFormat("tr-TR", {
  timeZone: TZ,
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function dayKey(iso: string): string {
  return dayKeyFmt.format(new Date(iso));
}

function shiftKey(key: string, days: number): string {
  return new Date(new Date(`${key}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function dayHeading(key: string, today: string): { main: string; sub: string | null } {
  const full = dayLabelFmt.format(new Date(`${key}T12:00:00+03:00`));
  if (key === today) return { main: "Bugün", sub: full };
  if (key === shiftKey(today, 1)) return { main: "Yarın", sub: full };
  if (key === shiftKey(today, -1)) return { main: "Dün", sub: full };
  return { main: full, sub: null };
}

/* ───────────────────────── gruplama ───────────────────────── */

type PostGroup = {
  postId: string;
  title: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  thumb: TargetRow["thumb"];
  mediaCount: number;
  autoPublish: boolean;
  approved: boolean;
  /** Taslakta (arşivde) mı. */
  draft: boolean;
  /** Sıralama ve gün başlığı için kullanılan an. */
  at: string;
  targets: TargetRow[];
};

/** Taslaktaki içerik paylaşılmış hedefleri dışında yalnızca "Taslak"ta görünür. */
function inTab(t: TargetRow, tab: Tab): boolean {
  if (tab === "published") return t.status === "published";
  if (tab === "draft") return Boolean(t.draftAt) && t.status !== "published";
  if (t.draftAt) return false;
  if (tab === "upcoming") return t.status === "pending" || t.status === "publishing";
  if (tab === "failed") return t.status === "failed";
  return false;
}

function groupByPost(rows: TargetRow[], tab: Tab): PostGroup[] {
  const map = new Map<string, PostGroup>();
  for (const r of rows) {
    const at = tab === "published" ? (r.publishedAt ?? r.scheduledAt) : r.scheduledAt;
    const g = map.get(r.postId);
    if (g) {
      g.targets.push(r);
      if (tab === "published" && at > g.at) g.at = at;
    } else {
      map.set(r.postId, {
        postId: r.postId,
        title: r.postTitle || r.captionPreview || "Başlıksız içerik",
        tenantId: r.tenantId,
        tenantName: r.tenantName,
        tenantSlug: r.tenantSlug,
        thumb: r.thumb,
        mediaCount: r.mediaCount,
        autoPublish: r.autoPublish,
        approved: r.approved,
        draft: Boolean(r.draftAt),
        at,
        targets: [r],
      });
    }
  }
  const order = SOCIAL_PLATFORMS as readonly string[];
  const groups = [...map.values()];
  for (const g of groups) g.targets.sort((a, b) => order.indexOf(a.platform) - order.indexOf(b.platform));
  return groups.sort((a, b) => (tab === "upcoming" ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at)));
}

/* ───────────────────────── bileşen ───────────────────────── */

export default function SocialPublishingDashboard({
  health,
  counts,
  targets,
  matrix,
  canEdit,
  today,
  now,
}: {
  health: HealthItem[];
  counts: SocialCounts;
  targets: TargetRow[];
  matrix: AccountMatrixRow[];
  canEdit: boolean;
  /** İstanbul gün anahtarı (YYYY-MM-DD) — sunucudan gelir, hydration uyumu için. */
  today: string;
  /** Sunucu anı (ISO) — "zamanı geçti" etiketi için. */
  now: string;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [tab, setTab] = useState<Tab>(counts.failed > 0 ? "failed" : "upcoming");
  const [query, setQuery] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [platform, setPlatform] = useState<SocialPlatformKey | "">("");
  const [todayOnly, setTodayOnly] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(false);
  /** Meta bağlama penceresi: null = kapalı; tek satır = yalnızca o marka. */
  const [connectRows, setConnectRows] = useState<AccountMatrixRow[] | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  /** Paylaşım penceresi: null = kapalı, { postId: null } = yeni. */
  const [compose, setCompose] = useState<{ postId: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const worst: HealthLevel = health.some((h) => h.level === "error")
    ? "error"
    : health.some((h) => h.level === "warn")
      ? "warn"
      : "ok";
  const [healthOpen, setHealthOpen] = useState(worst !== "ok");

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

  const q = query.trim().toLocaleLowerCase("tr");

  const tabCounts = useMemo(() => {
    const c = { upcoming: 0, published: 0, failed: 0, draft: 0 };
    for (const t of targets) {
      if (t.status === "published") c.published++;
      else if (t.draftAt) c.draft++;
      else if (t.status === "failed") c.failed++;
      else c.upcoming++;
    }
    return c;
  }, [targets]);

  const groups = useMemo(() => {
    if (tab === "accounts") return [];
    const rows = targets.filter(
      (t) =>
        inTab(t, tab) &&
        (!tenantId || t.tenantId === tenantId) &&
        (!platform || t.platform === platform) &&
        (!todayOnly || tab !== "upcoming" || dayKey(t.scheduledAt) === today) &&
        (!q ||
          [t.postTitle, t.captionPreview, t.tenantName, t.account ?? ""].some((s) =>
            s.toLocaleLowerCase("tr").includes(q),
          )),
    );
    return groupByPost(rows, tab);
  }, [targets, tab, tenantId, platform, todayOnly, today, q]);

  const days = useMemo(() => {
    const out: { key: string; items: PostGroup[] }[] = [];
    for (const g of groups) {
      const key = dayKey(g.at);
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(g);
      else out.push({ key, items: [g] });
    }
    return out;
  }, [groups]);

  /** Tabloda: görünür markalar + hesabı bağlı gizli markalar. */
  const listed = useMemo(
    () => matrix.filter((m) => m.visible || Object.keys(m.accounts).length > 0),
    [matrix],
  );
  const matrixRows = useMemo(
    () =>
      listed.filter(
        (m) =>
          (!onlyMissing || !m.accounts.instagram || !m.accounts.facebook) &&
          (!q || m.tenantName.toLocaleLowerCase("tr").includes(q)),
      ),
    [listed, onlyMissing, q],
  );
  const metaConnected = listed.filter((m) => m.accounts.instagram || m.accounts.facebook).length;
  // Toplu bağla gizli markaları da alır; pencerede yalnızca sayfa eşleşmesi olanlar gösterilir.
  const unconnected = useMemo(() => matrix.filter((m) => !m.accounts.facebook), [matrix]);
  const takenPageIds = useMemo(
    () => matrix.flatMap((m) => (m.accounts.facebook ? [m.accounts.facebook.externalId] : [])),
    [matrix],
  );
  const metaBrands = useMemo(
    () =>
      matrix
        .filter((m) => m.accounts.instagram || m.accounts.facebook)
        .sort((a, b) => a.tenantName.localeCompare(b.tenantName, "tr")),
    [matrix],
  );

  const listFiltersActive = Boolean(tenantId || platform || todayOnly);
  const hasActiveFilters = Boolean(q) || (tab === "accounts" ? onlyMissing : listFiltersActive);

  function clearFilters() {
    setQuery("");
    setTenantId("");
    setPlatform("");
    setTodayOnly(false);
    setOnlyMissing(false);
  }

  function goTab(next: Tab, opts: { today?: boolean } = {}) {
    setTab(next);
    setTodayOnly(Boolean(opts.today));
  }

  /** Saati geçmiş onaysız içeriği onaylar — zamanlayıcı bir dakika içinde paylaşır. */
  async function approve(g: PostGroup) {
    if (!await confirmDialog(`“${g.title}” onaylansın mı? Saati geçtiği için bir dakika içinde paylaşılacak.`)) return;
    setBusy(`ok:${g.postId}`);
    setError(null);
    try {
      const res = await fetch(`/api/panel/content-posts/${g.postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error || "Onaylanamadı");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Onaylanamadı");
    } finally {
      setBusy(null);
    }
  }

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

  /** Taslağa al / taslaktan geri al — taslaktaki içeriğe zamanlayıcı dokunmaz. */
  async function setDraft(g: PostGroup, draft: boolean) {
    setBusy(`draft:${g.postId}`);
    setError(null);
    try {
      const res = await fetch(`/api/panel/content-posts/${g.postId}/publish`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error || "Güncellenemedi");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Güncellenemedi");
    } finally {
      setBusy(null);
    }
  }

  /** Yayınlanmamış paylaşım planını siler; içerik takvimde kalır. */
  async function removePlan(g: PostGroup) {
    if (
      !await confirmDialog(
        `“${g.title}” paylaşım planı silinsin mi?\n\nİçerik takvimde kalır; isterseniz “Takvimdeki içerikleri bağla” ile yeniden ekleyebilirsiniz.`,
      )
    )
      return;
    setBusy(`del:${g.postId}`);
    setError(null);
    try {
      const res = await fetch(`/api/panel/content-posts/${g.postId}/publish`, { method: "DELETE" });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error || "Silinemedi");
      refresh();
      void alertDialog({
        tone: "success",
        message: `Paylaşım planı silindi.\n\n“${g.title}” artık Paylaşımlar'da görünmüyor; içerik takvimde duruyor.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Silinemedi");
    } finally {
      setBusy(null);
    }
  }

  async function remove(g: PostGroup) {
    const live = g.targets.filter((t) => t.status === "published" && DELETABLE.has(t.platform));
    if (!live.length) return;
    const where = live.map((t) => `${SOCIAL_PLATFORM_LABEL[t.platform]} ${FORMAT_LABEL[t.format].toLocaleLowerCase("tr")}`).join(" ve ");
    if (!await confirmDialog(`“${g.title}” paylaşımı ${where} üzerinden kalıcı olarak silinsin mi?\n\nİçerik takvimde kalır, yeniden paylaşılabilir.`)) return;
    setBusy(`del:${g.postId}`);
    setError(null);
    const failed: string[] = [];
    for (const t of live) {
      try {
        const res = await fetch(`/api/panel/content-posts/${g.postId}/publish?platform=${t.platform}`, { method: "DELETE" });
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(j.error || "Silinemedi");
      } catch (err) {
        failed.push(`${SOCIAL_PLATFORM_LABEL[t.platform]}: ${err instanceof Error ? err.message : "Silinemedi"}`);
      }
    }
    if (failed.length) setError(failed.join(" · "));
    setBusy(null);
    refresh();
    const done = live.length - failed.length;
    if (done > 0) {
      void alertDialog(
        failed.length
          ? {
              message: `Paylaşım kısmen silindi.\n\n${done} platformdan kaldırıldı, ${failed.length} platformda silinemedi:\n${failed.join("\n")}`,
            }
          : {
              tone: "success",
              message: `Paylaşım silindi.\n\n“${g.title}” ${where} üzerinden kaldırıldı. İçerik takvimde duruyor, yeniden paylaşılabilir.`,
            },
      );
    }
  }

  const tabs: { key: Tab; label: string; count: number; alert?: boolean }[] = [
    { key: "upcoming", label: "Yaklaşan", count: tabCounts.upcoming },
    { key: "published", label: "Paylaşılan", count: tabCounts.published },
    { key: "failed", label: "Hatalı", count: tabCounts.failed, alert: tabCounts.failed > 0 },
    { key: "draft", label: "Taslak", count: tabCounts.draft },
    { key: "accounts", label: "Hesaplar", count: metaConnected },
  ];

  const resultCount =
    tab === "accounts" ? `${matrixRows.length} marka` : `${groups.length} içerik`;

  return (
    <div className="space-y-4">
      {/* ── araç çubuğu ── */}
      <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {/* özet — her sayı ilgili listeyi açar */}
          <div
            className="flex items-stretch divide-x divide-zinc-200/80 overflow-hidden rounded-full bg-zinc-100"
            role="group"
            aria-label="Paylaşım özeti"
          >
            <Stat
              value={counts.queued}
              label="sırada"
              title="Otomatik paylaşılmayı bekleyen hedefler"
              onClick={() => goTab("upcoming")}
            />
            <Stat
              value={counts.dueToday}
              label="bugün"
              title="Bugün paylaşılacak hedefler"
              onClick={() => goTab("upcoming", { today: true })}
            />
            <Stat
              value={counts.published7d}
              label="son 7 gün"
              title="Son 7 günde paylaşılan hedefler"
              onClick={() => goTab("published")}
            />
            <Stat
              value={counts.failed}
              label="hatalı"
              title="Hata alan hedefler"
              alert
              onClick={() => goTab("failed")}
            />
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={
                worst === "error" ? toolChip(true, "rose") : worst === "warn" ? toolChip(true, "amber") : toolChip()
              }
              aria-expanded={healthOpen}
              aria-controls="social-health"
              onClick={() => setHealthOpen((v) => !v)}
            >
              <span className={`size-2 rounded-full ${LEVEL_DOT[worst]}`} aria-hidden />
              {worst === "error" ? "Sistemde sorun var" : worst === "warn" ? "Sistemde uyarı var" : "Sistem hazır"}
              <ChevronDown className={`size-3.5 transition ${healthOpen ? "rotate-180" : ""}`} aria-hidden />
            </button>
            <button
              type="button"
              className={toolChip()}
              onClick={refresh}
              disabled={refreshing}
              title="Listeyi ve sistem durumunu yenile"
            >
              {refreshing ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-3.5" aria-hidden />
              )}
              Yenile
            </button>
            {canEdit ? (
              <button type="button" onClick={() => setLinkOpen(true)} className={toolChip()}>
                <Link2 className="size-3.5" aria-hidden />
                Takvimdeki içerikleri bağla
              </button>
            ) : null}
            <Link href="/takvim" className={toolChip()}>
              <CalendarDays className="size-3.5" aria-hidden />
              Takvim
            </Link>
            {canEdit ? (
              <button type="button" onClick={() => setCompose({ postId: null })} className={toolPrimary}>
                <Plus className="size-3.5" aria-hidden />
                Yeni paylaşım
              </button>
            ) : null}
          </div>
        </div>

        {/* sistem durumu — sorun varsa açık gelir */}
        {healthOpen ? (
          <ul
            id="social-health"
            className="grid gap-x-6 gap-y-2.5 rounded-xl bg-zinc-50 p-3.5 sm:grid-cols-2"
          >
            {health.map((h) => (
              <li key={h.key} className="flex min-w-0 items-start gap-2.5">
                <span className={`mt-[5px] size-2 shrink-0 rounded-full ${LEVEL_DOT[h.level]}`} aria-hidden />
                <div className="min-w-0 text-xs leading-relaxed">
                  <p>
                    <span className="font-semibold text-zinc-800">{h.label}</span>
                    <span className={`ml-1.5 ${LEVEL_TEXT[h.level]}`}>{h.summary}</span>
                  </p>
                  {h.detail ? <p className="break-words text-zinc-500">{h.detail}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
          <div
            className="flex h-8 max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-zinc-100 p-0.5"
            role="tablist"
            aria-label="Görünüm"
          >
            {tabs.map((t) => {
              const on = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => goTab(t.key)}
                  className={`inline-flex h-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-medium transition focus-visible:outline-offset-[-2px] ${
                    on ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"
                  }`}
                >
                  {t.label}
                  <span
                    className={`tabular-nums ${
                      t.alert ? "font-semibold text-rose-600" : on ? "text-zinc-500" : "text-zinc-400"
                    }`}
                  >
                    {t.key === "accounts" ? `${t.count}/${listed.length}` : t.count}
                  </span>
                </button>
              );
            })}
          </div>

          <label className="relative flex h-8 w-full items-center sm:w-52">
            <Search className="pointer-events-none absolute left-2.5 size-3.5 text-zinc-400" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
              }}
              placeholder={tab === "accounts" ? "Marka ara" : "İçerik veya marka ara"}
              aria-label={tab === "accounts" ? "Marka ara" : "İçerik veya marka ara"}
              className={`${toolField} pl-8 pr-7 [&::-webkit-search-cancel-button]:hidden`}
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Aramayı temizle"
                className="absolute right-1.5 rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </label>

          {tab === "accounts" ? (
            <>
              <button
                type="button"
                aria-pressed={onlyMissing}
                onClick={() => setOnlyMissing((v) => !v)}
                className={toolChip(onlyMissing, "amber")}
              >
                Meta eksik olanlar
              </button>
              {canEdit && unconnected.length > 0 ? (
                <button type="button" onClick={() => setConnectRows(unconnected)} className={toolPrimary}>
                  <Link2 className="size-3.5" aria-hidden />
                  Hesap bağla
                </button>
              ) : null}
            </>
          ) : (
            <>
              <FilterSelect
                label="Marka"
                value={tenantId}
                onChange={setTenantId}
                options={tenants.map(([id, name]) => ({ value: id, label: name }))}
              />
              <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Platform">
                {SOCIAL_PLATFORMS.map((p) => {
                  const on = platform === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setPlatform(on ? "" : p)}
                      title={SOCIAL_PLATFORM_LABEL[p]}
                      aria-label={SOCIAL_PLATFORM_LABEL[p]}
                      className={`inline-flex size-8 items-center justify-center rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e91825] ${
                        on ? "bg-[#141111] text-white" : "bg-zinc-100 hover:bg-zinc-200/70"
                      }`}
                    >
                      <SocialIcon platform={p} brand={!on} className="size-4" />
                    </button>
                  );
                })}
              </div>
              {tab === "upcoming" ? (
                <button
                  type="button"
                  aria-pressed={todayOnly}
                  onClick={() => setTodayOnly((v) => !v)}
                  className={toolChip(todayOnly, "amber")}
                >
                  <Clock className="size-3.5" aria-hidden />
                  Bugün
                </button>
              ) : null}
            </>
          )}

          {hasActiveFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800"
            >
              <X className="size-3.5" aria-hidden />
              Temizle
            </button>
          ) : null}

          <span className="ml-auto text-xs tabular-nums text-zinc-500">
            {tab === "published" ? "Son 30 gün · " : ""}
            {resultCount}
          </span>
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      {/* ── içerik ── */}
      {connectRows ? (
        <BulkMetaConnect
          rows={connectRows}
          takenPageIds={takenPageIds}
          onClose={() => setConnectRows(null)}
          onChanged={refresh}
        />
      ) : null}
      {linkOpen ? <LinkCalendarPosts onClose={() => setLinkOpen(false)} onChanged={refresh} /> : null}
      {compose ? (
        <SocialComposer
          key={compose.postId ?? "new"}
          brands={metaBrands}
          postId={compose.postId}
          onClose={() => setCompose(null)}
          onChanged={refresh}
        />
      ) : null}

      {tab === "accounts" ? (
        <AccountsTable
          rows={matrixRows}
          total={listed.length}
          canEdit={canEdit}
          onConnect={(row) => setConnectRows([row])}
        />
      ) : days.length === 0 ? (
        <EmptyList tab={tab} filtered={hasActiveFilters} onClear={clearFilters} />
      ) : (
        <div className="space-y-5">
          {days.map((d) => {
            const h = dayHeading(d.key, today);
            return (
              <section key={d.key} className="space-y-2">
                <header className="flex items-baseline gap-2 px-1">
                  <h2
                    className={`text-sm font-semibold ${d.key === today ? "text-[#e91825]" : "text-zinc-800"}`}
                  >
                    {h.main}
                  </h2>
                  {h.sub ? <span className="text-xs text-zinc-500">{h.sub}</span> : null}
                  <span className="ml-auto text-[11px] tabular-nums text-zinc-400">{d.items.length} içerik</span>
                </header>
                <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
                  {d.items.map((g) => (
                    <PostRow
                      key={g.postId}
                      group={g}
                      tab={tab}
                      now={now}
                      canEdit={canEdit}
                      busy={busy}
                      onRetry={retry}
                      onRemove={remove}
                      onRemovePlan={removePlan}
                      onDraft={setDraft}
                      onApprove={approve}
                      onOpen={(id) => setCompose({ postId: id })}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── parçalar ───────────────────────── */

function Stat({
  value,
  label,
  title,
  alert = false,
  onClick,
}: {
  value: number;
  label: string;
  title: string;
  /** Sıfırdan büyükse sayı kırmızı. */
  alert?: boolean;
  onClick: () => void;
}) {
  const active = value > 0;
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="group inline-flex h-8 items-baseline gap-1.5 whitespace-nowrap px-3.5 pt-[7px] transition hover:bg-zinc-200/70"
    >
      <span
        className={`text-[13px] font-semibold tabular-nums ${
          !active ? "text-zinc-400" : alert ? "text-rose-600" : "text-zinc-900"
        }`}
      >
        {value}
      </span>
      <span className="text-xs text-zinc-500 group-hover:text-zinc-800">{label}</span>
    </button>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const on = Boolean(value);
  return (
    <label className="relative inline-flex">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={toolSelect(on)}
      >
        <option value="">{label}: Tümü</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className={`pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 ${
          on ? "text-white" : "text-zinc-400"
        }`}
        aria-hidden
      />
    </label>
  );
}

function PostRow({
  group: g,
  tab,
  now,
  canEdit,
  busy,
  onRetry,
  onRemove,
  onRemovePlan,
  onDraft,
  onApprove,
  onOpen,
}: {
  group: PostGroup;
  tab: Tab;
  now: string;
  canEdit: boolean;
  busy: string | null;
  onRetry: (r: TargetRow) => void;
  onRemove: (g: PostGroup) => void;
  onRemovePlan: (g: PostGroup) => void;
  onDraft: (g: PostGroup, draft: boolean) => void;
  onApprove: (g: PostGroup) => void;
  /** Paylaşım penceresinde aç. */
  onOpen: (postId: string) => void;
}) {
  const removable = canEdit && g.targets.some((t) => t.status === "published" && DELETABLE.has(t.platform));
  /** Yayınlanmamış plan silinebilir / taslağa alınabilir (paylaşılırken değil). */
  const planned = g.targets.some((t) => t.status === "pending" || t.status === "failed");
  const inFlight = g.targets.some((t) => t.status === "publishing");
  const late = tab === "upcoming" && g.at < now && g.targets.some((t) => t.status === "pending");
  const unapproved =
    tab === "draft" ? [] : g.targets.filter((t) => t.status === "pending" && t.lastError === UNAPPROVED_NOTE);
  const problems = g.targets.filter(
    (t) => t.lastError && t.status !== "published" && t.lastError !== UNAPPROVED_NOTE,
  );
  const retryAt = g.targets.find((t) => t.status === "pending" && t.nextAttemptAt)?.nextAttemptAt;

  return (
    <li
      className="group/row flex cursor-pointer gap-3 px-3 py-3 transition hover:bg-zinc-50/80 sm:px-4"
      onClick={(e) => {
        // İç düğme / bağlantılar kendi işini yapar; kartın geri kalanı pencereyi açar.
        if ((e.target as HTMLElement).closest("a, button")) return;
        onOpen(g.postId);
      }}
    >
      <div className="w-11 shrink-0 pt-0.5 text-right">
        <p className="text-sm font-semibold tabular-nums text-zinc-900">{timeFmt.format(new Date(g.at))}</p>
        {late ? <p className="text-[10px] font-semibold text-amber-700">gecikti</p> : null}
        {tab === "draft" ? <p className="text-[10px] font-semibold text-zinc-500">taslak</p> : null}
      </div>

      <button
        type="button"
        onClick={() => onOpen(g.postId)}
        className="relative size-12 shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100"
        aria-label="Paylaşımı aç"
      >
        {g.thumb?.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={g.thumb.url} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-zinc-400">
            {g.thumb?.kind === "video" ? (
              <Film className="size-4" aria-hidden />
            ) : (
              <ImageOff className="size-4" aria-hidden />
            )}
          </span>
        )}
        {g.mediaCount > 1 ? (
          <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 text-[10px] leading-4 text-white">
            {g.mediaCount}
          </span>
        ) : null}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-x-2 sm:flex-row sm:items-baseline">
          <button
            type="button"
            onClick={() => onOpen(g.postId)}
            className="min-w-0 truncate text-left text-sm font-semibold text-zinc-900 hover:underline"
          >
            {g.title}
          </button>
          <Link
            href={`/brands/${g.tenantSlug}#sosyal-hesaplar`}
            className="shrink-0 self-start text-xs text-zinc-500 hover:text-zinc-900 hover:underline sm:self-auto"
          >
            {g.tenantName}
          </Link>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {g.targets.map((t) => (
            <TargetChip key={t.id} target={t} />
          ))}
          {tab === "upcoming" && g.autoPublish && !g.approved ? (
            <span
              className="inline-flex h-6 items-center gap-1 rounded-full bg-sky-50 px-2 text-[11px] font-medium text-sky-800"
              title="Otomatik paylaşım için içeriğin durumu takvimde “Onaylandı” olmalı."
            >
              <Clock className="size-3" aria-hidden />
              Onay bekliyor
            </span>
          ) : null}
          {tab === "upcoming" && !g.autoPublish ? (
            <span
              className="inline-flex h-6 items-center gap-1 rounded-full bg-zinc-100 px-2 text-[11px] font-medium text-zinc-600"
              title="İçerikte “Zamanı gelince otomatik paylaş” kapalı — yalnızca elle paylaşılır."
            >
              <CircleDashed className="size-3" aria-hidden />
              Otomatik kapalı
            </span>
          ) : null}
          {retryAt ? (
            <span className="text-[11px] text-zinc-500">tekrar denenecek {shortFmt.format(new Date(retryAt))}</span>
          ) : null}
        </div>

        {unapproved.length ? (
          <div className="mt-2 flex flex-col gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 sm:flex-row sm:items-start sm:gap-2">
            <p className="flex min-w-0 flex-1 items-start gap-2 leading-relaxed">
              <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">{UNAPPROVED_NOTE}</span>
            </p>
            {canEdit ? (
              <button
                type="button"
                className="inline-flex h-6 shrink-0 items-center gap-1 self-start rounded-md border border-amber-300 bg-white px-2 text-[11px] font-semibold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"
                disabled={busy !== null}
                onClick={() => onApprove(g)}
              >
                {busy === `ok:${g.postId}` ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                ) : (
                  <Check className="size-3" aria-hidden />
                )}
                Onayla
              </button>
            ) : null}
          </div>
        ) : null}

        {problems.length ? (
          <ul className="mt-2 space-y-1.5">
            {problems.map((t) => (
              <li
                key={t.id}
                className="flex flex-col gap-1.5 rounded-lg border border-rose-100 bg-rose-50/60 px-2.5 py-1.5 text-xs text-rose-800 sm:flex-row sm:items-start sm:gap-2"
              >
                <p className="flex min-w-0 flex-1 items-start gap-2 leading-relaxed">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0 break-words">
                    <span className="font-semibold">{SOCIAL_PLATFORM_LABEL[t.platform]}:</span> {t.lastError}
                    {t.attempts > 1 ? <span className="text-rose-600/80"> · {t.attempts} deneme</span> : null}
                  </span>
                </p>
                {canEdit && t.status === "failed" ? (
                  <button
                    type="button"
                    className="inline-flex h-6 shrink-0 items-center gap-1 self-start rounded-md border border-rose-200 bg-white px-2 text-[11px] font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-50 disabled:opacity-50"
                    disabled={busy !== null}
                    onClick={() => onRetry(t)}
                  >
                    {busy === t.id ? (
                      <Loader2 className="size-3 animate-spin" aria-hidden />
                    ) : (
                      <RotateCcw className="size-3" aria-hidden />
                    )}
                    Tekrar dene
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex shrink-0 items-start gap-0.5 self-start">
        <RowAction icon={PencilLine} label="Düzenle" title="Paylaşımı düzenle" onClick={() => onOpen(g.postId)} />
        {canEdit && planned && tab !== "published" ? (
          g.draft ? (
            <RowAction
              icon={ArchiveRestore}
              label="Geri al"
              title="Taslaktan çıkar — yeniden sıraya girer"
              busy={busy === `draft:${g.postId}`}
              disabled={busy !== null}
              onClick={() => onDraft(g, false)}
            />
          ) : (
            <RowAction
              icon={Archive}
              label="Taslağa al"
              title="Paylaşımı beklet — otomatik paylaşılmaz, Taslak sekmesinde durur"
              busy={busy === `draft:${g.postId}`}
              disabled={busy !== null || inFlight}
              onClick={() => onDraft(g, true)}
            />
          )
        ) : null}
        {removable ? (
          <RowAction
            icon={Trash2}
            label="Sil"
            title="Paylaşımı platformdan sil"
            tone="danger"
            busy={busy === `del:${g.postId}`}
            disabled={busy !== null}
            onClick={() => onRemove(g)}
          />
        ) : canEdit && planned ? (
          <RowAction
            icon={Trash2}
            label="Sil"
            title="Paylaşım planını sil — içerik takvimde kalır"
            tone="danger"
            busy={busy === `del:${g.postId}`}
            disabled={busy !== null || inFlight}
            onClick={() => onRemovePlan(g)}
          />
        ) : null}
      </div>
    </li>
  );
}

function RowAction({
  icon: Icon,
  label,
  title,
  onClick,
  busy = false,
  disabled = false,
  tone = "default",
}: {
  icon: typeof Trash2;
  label: string;
  title: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      className={`inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-zinc-500 transition disabled:opacity-50 ${
        tone === "danger" ? "hover:bg-rose-50 hover:text-rose-700" : "hover:bg-zinc-100 hover:text-zinc-900"
      }`}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Icon className="size-3.5" aria-hidden />}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function TargetChip({ target: t }: { target: TargetRow }) {
  const label = `${SOCIAL_PLATFORM_LABEL[t.platform]} · ${FORMAT_LABEL[t.format]}`;
  const title = [PUBLISH_STATUS_LABEL[t.status], t.account].filter(Boolean).join(" · ");
  const cls = `inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium ${STATUS_TONE[t.status]}`;
  const body = (
    <>
      <SocialIcon platform={t.platform} brand className="size-3" />
      {label}
      {t.status === "publishing" ? (
        <Loader2 className="size-3 animate-spin" aria-hidden />
      ) : t.status === "published" ? (
        t.permalink ? (
          <ExternalLink className="size-3" aria-hidden />
        ) : (
          <Check className="size-3" aria-hidden />
        )
      ) : t.status === "failed" ? (
        <X className="size-3" aria-hidden />
      ) : null}
      <span className="sr-only">{PUBLISH_STATUS_LABEL[t.status]}</span>
    </>
  );
  return t.permalink ? (
    <a
      href={t.permalink}
      target="_blank"
      rel="noopener noreferrer"
      title={`${title} — paylaşımı aç`}
      className={`${cls} transition hover:border-emerald-400`}
    >
      {body}
    </a>
  ) : (
    <span className={cls} title={title}>
      {body}
    </span>
  );
}

function EmptyList({ tab, filtered, onClear }: { tab: Tab; filtered: boolean; onClear: () => void }) {
  const text = filtered
    ? "Bu filtrelerle eşleşen paylaşım yok."
    : tab === "upcoming"
      ? "Sırada paylaşım yok. “Yeni paylaşım” ile planlayın ya da takvimdeki içerikleri bağlayın."
      : tab === "published"
        ? "Son 30 günde paylaşım yok."
        : tab === "draft"
          ? "Taslakta paylaşım yok. Bir paylaşımı bekletmek için kartındaki “Taslağa al”ı kullanın."
          : "Hatalı paylaşım yok.";
  return (
    <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-10 text-center">
      <p className="mx-auto max-w-md text-sm text-zinc-500">{text}</p>
      {filtered ? (
        <button
          type="button"
          onClick={onClear}
          className="mt-3 text-sm font-semibold text-zinc-900 underline-offset-2 hover:underline"
        >
          Filtreleri temizle
        </button>
      ) : tab === "upcoming" ? (
        <Link href="/takvim" className="mt-3 inline-block text-sm font-semibold text-[#e91825] hover:underline">
          Takvime git
        </Link>
      ) : null}
    </div>
  );
}

/** Bağlantı durumu gösterilen (yayın motoru hazır) platformlar. */
const ACCOUNT_PLATFORMS = SOCIAL_PLATFORMS.filter((p) => PUBLISHER_READY[p]);
const SOON_PLATFORMS = SOCIAL_PLATFORMS.filter((p) => !PUBLISHER_READY[p]);

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? "?").slice(0, 2)).toLocaleUpperCase("tr");
}

/** Görsel yüklenemezse (süresi dolmuş Meta CDN bağlantısı vb.) yedek gösterilir. */
function Avatar({
  src,
  fallback,
  className,
}: {
  src: string | null;
  fallback: React.ReactNode;
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-100 ${className}`}>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        fallback
      )}
    </span>
  );
}

function AccountsTable({
  rows,
  total,
  canEdit,
  onConnect,
}: {
  rows: AccountMatrixRow[];
  total: number;
  canEdit: boolean;
  /** Satırdaki "Bağla": bağlama penceresini yalnızca bu markayla açar. */
  onConnect: (row: AccountMatrixRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-10 text-center text-sm text-zinc-500">
        {total === 0 ? "Henüz marka yok." : "Eşleşen marka yok."}
      </p>
    );
  }

  const isConnected = (m: AccountMatrixRow) => ACCOUNT_PLATFORMS.some((p) => m.accounts[p]);
  const connected = rows.filter(isConnected).length;
  const pct = Math.round((connected / rows.length) * 100);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      {/* özet */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-100 px-4 py-3">
        <p className="text-sm text-zinc-600">
          <span className="font-semibold tabular-nums text-zinc-900">{connected}</span> marka bağlı
          {rows.length - connected > 0 ? (
            <>
              <span className="mx-1.5 text-zinc-300">·</span>
              <span className="font-semibold tabular-nums text-zinc-900">{rows.length - connected}</span> bağlı değil
            </>
          ) : null}
        </p>
        <div
          className="h-1.5 w-40 overflow-hidden rounded-full bg-zinc-100"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Bağlı marka oranı"
        >
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="px-4 py-2.5 font-medium">Marka</th>
              {ACCOUNT_PLATFORMS.map((p) => (
                <th key={p} className="px-3 py-2.5 font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <SocialIcon platform={p} brand className="size-3.5" />
                    {SOCIAL_PLATFORM_LABEL[p]}
                  </span>
                </th>
              ))}
              <th className="w-px px-4 py-2.5">
                <span className="sr-only">İşlem</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const brandHref = `/brands/${m.tenantSlug}#sosyal-hesaplar`;
              const linked = isConnected(m);
              const hasError = ACCOUNT_PLATFORMS.some((p) => m.accounts[p]?.lastError);
              return (
                <tr key={m.tenantId} className="border-t border-zinc-100 transition hover:bg-zinc-50/70">
                  <td className="px-4 py-2.5">
                    <Link href={brandHref} className="group flex min-w-0 items-center gap-2.5">
                      <Avatar
                        src={m.coverUrl}
                        className="size-8 ring-1 ring-zinc-200"
                        fallback={
                          <span className="text-[11px] font-semibold text-zinc-500">{initials(m.tenantName)}</span>
                        }
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-zinc-900 group-hover:underline">
                          {m.tenantName}
                        </span>
                        {!m.visible ? <span className="block text-[11px] text-zinc-400">gizli marka</span> : null}
                      </span>
                    </Link>
                  </td>

                  {ACCOUNT_PLATFORMS.map((p) => {
                    const a = m.accounts[p];
                    if (!a) {
                      return (
                        <td key={p} className="px-3 py-2.5">
                          {linked ? (
                            <span className="text-xs text-zinc-400" title="Facebook sayfasına bağlı profesyonel hesap yok">
                              Sayfaya bağlı değil
                            </span>
                          ) : (
                            <span className="text-xs text-zinc-300">—</span>
                          )}
                        </td>
                      );
                    }
                    const body = (
                      <>
                        <span className="relative">
                          <Avatar
                            src={a.pictureUrl}
                            className="size-6"
                            fallback={<SocialIcon platform={p} brand className="size-3.5" />}
                          />
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-white ${
                              a.lastError ? "bg-rose-500" : "bg-emerald-500"
                            }`}
                            aria-hidden
                          />
                        </span>
                        <span className={`truncate ${a.lastError ? "text-rose-700" : "text-zinc-800"}`}>{a.label}</span>
                      </>
                    );
                    const cls = "inline-flex max-w-[220px] items-center gap-2 text-xs";
                    return (
                      <td key={p} className="px-3 py-2.5">
                        {a.href ? (
                          <a
                            href={a.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`${cls} rounded-full hover:underline`}
                            title={a.lastError ?? `${a.label} — profili aç`}
                          >
                            {body}
                          </a>
                        ) : (
                          <span className={cls} title={a.lastError ?? a.label}>
                            {body}
                          </span>
                        )}
                      </td>
                    );
                  })}

                  <td className="px-4 py-2.5 text-right">
                    {canEdit && (!linked || hasError) ? (
                      <button type="button" onClick={() => onConnect(m)} className={`${toolChip(false)} !h-7`}>
                        {hasError ? "Yeniden bağla" : "Bağla"}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-zinc-100 bg-zinc-50/70 px-4 py-2.5 text-xs text-zinc-500">
        <Info className="size-3.5 shrink-0" aria-hidden />
        Instagram, bağlı olduğu Facebook sayfasıyla birlikte gelir.
        {SOON_PLATFORMS.length ? (
          <span className="inline-flex items-center gap-1">
            {SOON_PLATFORMS.map((p) => (
              <SocialIcon key={p} platform={p} brand className="size-3" />
            ))}
            {SOON_PLATFORMS.map((p) => SOCIAL_PLATFORM_LABEL[p]).join(" ve ")} bağlantısı sonraki aşamada.
          </span>
        ) : null}
      </p>
    </div>
  );
}
