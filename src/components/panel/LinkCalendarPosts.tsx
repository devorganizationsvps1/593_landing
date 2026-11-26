"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ImageOff, Loader2, X } from "lucide-react";
import { toolPrimary } from "@/components/panel/ds/buttons";
import { SocialIcon } from "@/components/panel/ds/social-icons";
import { SOCIAL_PLATFORM_LABEL, type SocialPlatformKey } from "@/lib/social/formats";

type Candidate = {
  id: string;
  title: string;
  tenantName: string;
  scheduledAt: string;
  status: string;
  platforms: SocialPlatformKey[];
  mediaCount: number;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Taslak",
  design: "Tasarımda",
  review: "Onayda",
  approved: "Onaylandı",
};

const dateFmt = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Istanbul",
  day: "numeric",
  month: "short",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Takvimde zaten olan içerikleri otomatik paylaşıma bağlar. Hiçbiri önceden
 * seçili gelmez; bağlanan içerik "Onaylandı" olmadan paylaşılmaz.
 */
export default function LinkCalendarPosts({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  /** Bağlama sonrası liste yenilensin (ebeveynin yenileme göstergesiyle). */
  onChanged: () => void;
}) {
  const [posts, setPosts] = useState<Candidate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [autoPublish, setAutoPublish] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/panel/social/link-posts", { cache: "no-store" });
        const j = (await res.json()) as { posts?: Candidate[]; error?: string };
        if (!res.ok) throw new Error(j.error || "İçerikler alınamadı");
        if (alive) setPosts(j.posts ?? []);
      } catch (err) {
        if (alive) setLoadError(err instanceof Error ? err.message : "İçerikler alınamadı");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !running) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  const allPicked = Boolean(posts?.length) && picked.size === posts!.length;
  const noMedia = useMemo(
    () => (posts ?? []).filter((p) => picked.has(p.id) && p.mediaCount === 0).length,
    [posts, picked],
  );

  function toggle(id: string) {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/panel/social/link-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postIds: [...picked], autoPublish }),
      });
      const j = (await res.json()) as { linked?: number; skipped?: number; error?: string };
      if (!res.ok) throw new Error(j.error || "Bağlanamadı");
      setResult(
        `${j.linked ?? 0} içerik bağlandı${j.skipped ? `, ${j.skipped} atlandı (bu arada değişmiş)` : ""}.`,
      );
      setPosts((list) => (list ?? []).filter((p) => !picked.has(p.id)));
      setPicked(new Set());
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bağlanamadı");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !running) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-posts-title"
        className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white text-zinc-900 shadow-2xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
          <div>
            <h3 id="link-posts-title" className="text-base font-semibold">
              Takvimdeki içerikleri bağla
            </h3>
            <p className="mt-0.5 text-sm text-zinc-500">
              Seçtiğiniz içerikler planlanan platformlarına otomatik paylaşım hedefi olarak eklenir. Hiçbiri{" "}
              <strong className="font-semibold text-zinc-700">Onaylandı</strong> yapılmadan paylaşılmaz.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            aria-label="Kapat"
            className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-40"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loadError ? (
            <p className="m-5 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {loadError}
            </p>
          ) : !posts ? (
            <p className="flex items-center justify-center gap-2 px-5 py-14 text-sm text-zinc-500">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              İçerikler alınıyor…
            </p>
          ) : posts.length === 0 ? (
            <p className="px-5 py-14 text-center text-sm text-zinc-500">
              {result ?? "Bağlanacak içerik yok. Zamanı gelmemiş, hesabı bağlı markalardaki tüm içerikler zaten bağlı."}
            </p>
          ) : (
            <>
              <label className="flex cursor-pointer items-center gap-3 border-b border-zinc-100 bg-zinc-50/70 px-5 py-2.5 text-xs font-medium text-zinc-600">
                <input
                  type="checkbox"
                  className="size-4 accent-[#141111]"
                  checked={allPicked}
                  disabled={running}
                  onChange={() => setPicked(allPicked ? new Set() : new Set(posts.map((p) => p.id)))}
                />
                Tümünü seç <span className="font-normal text-zinc-400">({posts.length} içerik)</span>
              </label>
              <ul className="divide-y divide-zinc-100">
                {posts.map((p) => {
                  const on = picked.has(p.id);
                  return (
                    <li key={p.id}>
                      <label
                        className={`flex cursor-pointer items-start gap-3 px-5 py-3 transition ${
                          on ? "bg-zinc-50" : "hover:bg-zinc-50/60"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-1 size-4 shrink-0 accent-[#141111]"
                          checked={on}
                          disabled={running}
                          onChange={() => toggle(p.id)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline gap-x-2">
                            <span className="truncate text-sm font-medium">{p.title || "Başlıksız içerik"}</span>
                            <span className="text-xs text-zinc-500">{p.tenantName}</span>
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                            <span className="tabular-nums">{dateFmt.format(new Date(p.scheduledAt))}</span>
                            <span className="inline-flex items-center gap-1">
                              {p.platforms.map((pl) => (
                                <SocialIcon key={pl} platform={pl} brand className="size-3.5" />
                              ))}
                              {p.platforms.map((pl) => SOCIAL_PLATFORM_LABEL[pl]).join(" + ")}
                            </span>
                            <span className="rounded-full bg-zinc-100 px-2 py-px text-[11px] text-zinc-600">
                              {STATUS_LABEL[p.status] ?? p.status}
                            </span>
                            {p.mediaCount === 0 ? (
                              <span className="inline-flex items-center gap-1 text-amber-700">
                                <ImageOff className="size-3.5" aria-hidden />
                                Medya yok
                              </span>
                            ) : (
                              <span>{p.mediaCount} medya</span>
                            )}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <div className="shrink-0 space-y-2 border-t border-zinc-100 px-5 py-3">
          {noMedia > 0 ? (
            <p className="text-xs text-amber-800">
              Seçilenlerden {noMedia} içerikte medya yok — paylaşım zamanından önce takvimden görsel / video
              yüklenmeli.
            </p>
          ) : null}
          {error ? <p className="text-xs text-rose-700">{error}</p> : null}
          {result && posts?.length ? (
            <p className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
              <Check className="size-3.5" aria-hidden />
              {result}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                className="size-4 accent-[#e91825]"
                checked={autoPublish}
                disabled={running}
                onChange={(e) => setAutoPublish(e.target.checked)}
              />
              Zamanı gelince otomatik paylaş
              <span className="text-xs text-zinc-400">(yalnızca Onaylandı içerik)</span>
            </label>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={running}
                className="inline-flex h-9 items-center rounded-full px-4 text-sm text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40"
              >
                Kapat
              </button>
              <button
                type="button"
                onClick={() => void run()}
                disabled={running || picked.size === 0}
                className={`${toolPrimary} !h-9 !px-4 !text-sm`}
              >
                {running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {picked.size ? `${picked.size} içeriği bağla` : "İçerik seçin"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
