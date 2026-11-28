"use client";

import { confirmDialog } from "@/components/panel/ds/confirm";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { ContentPostStatus } from "@prisma/client";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Film,
  Loader2,
  RotateCcw,
  Send,
  Upload,
  X,
} from "lucide-react";
import { btnPrimary, btnSecondary, fieldClass } from "@/components/panel/ds/buttons";
import { SocialIcon } from "@/components/panel/ds/social-icons";
import {
  ACCEPTED_IMAGE_TYPES,
  ACCEPTED_VIDEO_TYPES,
  defaultFormat,
  FORMAT_LABEL,
  PLATFORM_FORMATS,
  PRIVACY_OPTIONS,
  PUBLISH_STATUS_LABEL,
  PUBLISHER_READY,
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABEL,
  validateTarget,
  youtubeTitleFrom,
  type PublishFormat,
  type SocialPlatformKey,
} from "@/lib/social/formats";
import type { PublishState, SerializedMedia, SerializedTarget } from "@/lib/social/state";

type TargetDraft = {
  enabled: boolean;
  format: PublishFormat;
  captionOverride: string;
  title: string;
  privacy: string;
  /** YouTube kapak görseli (yüklenmiş, kayıt bekleyebilir). */
  thumbKey: string | null;
  thumbUrl: string | null;
};

type Upload = { id: string; name: string; progress: number; error: string | null };

const STATUS_CLASS: Record<SerializedTarget["status"], string> = {
  pending: "bg-sky-50 text-sky-800",
  publishing: "bg-amber-50 text-amber-900",
  published: "bg-emerald-50 text-emerald-800",
  failed: "bg-rose-50 text-rose-800",
};

function draftsFrom(state: PublishState): Record<SocialPlatformKey, TargetDraft> {
  const out = {} as Record<SocialPlatformKey, TargetDraft>;
  for (const p of SOCIAL_PLATFORMS) {
    const t = state.targets.find((x) => x.platform === p);
    out[p] = {
      enabled: Boolean(t),
      format: t?.format ?? defaultFormat(p, state.media),
      captionOverride: t?.captionOverride ?? "",
      // YouTube başlığı boşsa takvimdeki içerik başlığıyla önerilir.
      title: t?.title ?? (p === "youtube" ? (youtubeTitleFrom(state.post.title, state.post.caption) ?? "") : ""),
      privacy: t?.privacy ?? PRIVACY_OPTIONS[p]?.[0]?.value ?? "",
      thumbKey: t?.thumbnailKey ?? null,
      thumbUrl: t?.thumbnailUrl ?? null,
    };
  }
  return out;
}

function fmtSize(n: number): string {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function videoMeta(file: File): Promise<{ width: number; height: number; durationSec: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      resolve({ width: v.videoWidth, height: v.videoHeight, durationSec: v.duration });
      URL.revokeObjectURL(url);
    };
    v.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    v.src = url;
  });
}

async function fetchState(postId: string): Promise<PublishState> {
  const res = await fetch(`/api/panel/content-posts/${postId}/publish`, { cache: "no-store" });
  const j = (await res.json()) as { state?: PublishState; error?: string };
  if (!res.ok || !j.state) throw new Error(j.error || "Paylaşım durumu alınamadı");
  return j.state;
}

function putWithProgress(url: string, file: File, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Yükleme başarısız (HTTP ${xhr.status})`));
    xhr.onerror = () => reject(new Error("Yükleme başarısız (ağ / CORS)"));
    xhr.send(file);
  });
}

/**
 * İçerik detayında otomatik paylaşım: medya yükleme, seçili platformların
 * formatı, zamanında otomatik paylaşım ve paylaşım durumu (canlı link, hata,
 * tekrar dene). Platformlar içerik formunun üstünden gelir; ayarlar formun
 * "Kaydet" düğmesiyle (`saveRef`) birlikte kaydedilir.
 */
export default function PublishPanel({
  postId,
  tenantSlug,
  caption,
  scheduledAt,
  platforms,
  status,
  canEdit,
  saveRef,
  unsaved,
}: {
  postId: string;
  tenantSlug: string;
  /** Formdaki (kaydedilmemiş olabilir) içerik metni — doğrulama için. */
  caption: string;
  scheduledAt: string;
  /** Formda seçili, otomatik paylaşım destekli platformlar. */
  platforms: SocialPlatformKey[];
  /** Formdaki içerik durumu — otomatik paylaşım yalnızca "approved"da çalışır. */
  status: ContentPostStatus;
  canEdit: boolean;
  /** Formun "Kaydet"i bunu çağırır: değişiklik varsa ayarları kaydeder, son durumu döner. */
  saveRef: MutableRefObject<(() => Promise<PublishState | null>) | null>;
  /** Formda kaydedilmemiş değişiklik var mı (metin, tarih, platform, durum). */
  unsaved: boolean;
}) {
  const [state, setState] = useState<PublishState | null>(null);
  const [drafts, setDrafts] = useState<Record<SocialPlatformKey, TargetDraft> | null>(null);
  const [autoPublish, setAutoPublish] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirtyRef = useRef(false);
  const [openedAt] = useState(() => Date.now());
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const apply = useCallback((s: PublishState, resetForm: boolean) => {
    setState(s);
    if (resetForm || !dirtyRef.current) {
      setDrafts(draftsFrom(s));
      setAutoPublish(s.autoPublish);
      setDirty(false);
    }
  }, []);

  const load = useCallback(
    (resetForm = false) =>
      fetchState(postId)
        .then((st) => apply(st, resetForm))
        .catch((err: unknown) => setError(err instanceof Error ? err.message : "Paylaşım durumu alınamadı")),
    [postId, apply],
  );

  useEffect(() => {
    let cancelled = false;
    fetchState(postId)
      .then((st) => {
        if (!cancelled) apply(st, true);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Paylaşım durumu alınamadı");
      });
    return () => {
      cancelled = true;
    };
  }, [postId, apply]);

  // Paylaşım sürerken durumu yokla.
  const inFlight = state?.targets.some((t) => t.status === "publishing") ?? false;
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [inFlight, load]);

  function patchDraft(p: SocialPlatformKey, patch: Partial<TargetDraft>) {
    setDrafts((d) => (d ? { ...d, [p]: { ...d[p], ...patch } } : d));
    setDirty(true);
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    for (const file of Array.from(files)) {
      const id = `${Date.now()}-${Math.random()}`;
      setUploads((u) => [...u, { id, name: file.name, progress: 0, error: null }]);
      const setU = (patch: Partial<Upload>) =>
        setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...patch } : x)));
      try {
        const pre = await fetch(`/api/panel/content-posts/${postId}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mime: file.type, size: file.size }),
        });
        const pj = (await pre.json()) as { key?: string; uploadUrl?: string; error?: string };
        if (!pre.ok || !pj.key || !pj.uploadUrl) throw new Error(pj.error || "Yükleme başlatılamadı");
        await putWithProgress(pj.uploadUrl, file, (progress) => setU({ progress }));
        const meta = file.type.startsWith("video/") ? await videoMeta(file) : null;
        const done = await fetch(`/api/panel/content-posts/${postId}/media/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: pj.key, mime: file.type, name: file.name, ...meta }),
        });
        const dj = (await done.json()) as { media?: SerializedMedia; error?: string };
        if (!done.ok || !dj.media) throw new Error(dj.error || "Yükleme tamamlanamadı");
        const media = dj.media;
        setState((s) => (s ? { ...s, media: [...s.media, media] } : s));
        setUploads((u) => u.filter((x) => x.id !== id));
      } catch (err) {
        setU({ error: err instanceof Error ? err.message : "Yükleme başarısız" });
      }
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  const thumbInput = useRef<HTMLInputElement>(null);

  /** Kapak hemen yüklenir; hedefe bağlanması "Kaydet" ile olur. */
  async function uploadThumb(file: File | undefined) {
    if (thumbInput.current) thumbInput.current.value = "";
    if (!file) return;
    setError(null);
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setError("Kapak JPG, PNG veya WebP olmalı.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Kapak dosyası en fazla 10 MB olabilir.");
      return;
    }
    setBusy("thumb");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/panel/content-posts/${postId}/thumbnail`, { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as { key?: string; url?: string; error?: string };
      if (!res.ok || !j.key || !j.url) throw new Error(j.error || "Kapak yüklenemedi");
      patchDraft("youtube", { thumbKey: j.key, thumbUrl: j.url });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kapak yüklenemedi");
    } finally {
      setBusy(null);
    }
  }

  async function removeMedia(m: SerializedMedia) {
    if (!await confirmDialog(`“${m.originalName || "Dosya"}” silinsin mi?`)) return;
    setBusy(`media:${m.id}`);
    setError(null);
    try {
      const res = await fetch(`/api/panel/content-posts/${postId}/media/${m.id}`, { method: "DELETE" });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error || "Silinemedi");
      setState((s) => (s ? { ...s, media: s.media.filter((x) => x.id !== m.id) } : s));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Silinemedi");
    } finally {
      setBusy(null);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    if (!state) return;
    const next = [...state.media];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j]!, next[index]!];
    setState({ ...state, media: next });
    await fetch(`/api/panel/content-posts/${postId}/media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: next.map((m) => m.id) }),
    }).catch(() => setError("Sıralama kaydedilemedi"));
  }

  /** Hedef olacak platformlar: formda seçili, hesabı bağlı, yayın motoru hazır. */
  const wanted = (st: PublishState) => {
    const connected = new Set(st.accounts.map((a) => a.platform));
    return SOCIAL_PLATFORMS.filter((p) => platforms.includes(p) && connected.has(p) && PUBLISHER_READY[p]);
  };

  function needsSave(st: PublishState): boolean {
    const now = wanted(st).join();
    const saved = SOCIAL_PLATFORMS.filter((p) => st.targets.some((t) => t.platform === p)).join();
    return dirty || autoPublish !== st.autoPublish || now !== saved;
  }

  async function saveSettings(): Promise<PublishState | null> {
    if (!drafts || !state) return null;
    if (!needsSave(state)) return state;
    setBusy("save");
    setError(null);
    try {
      const targets = wanted(state).map((p) => ({
        platform: p,
        format: drafts[p].format,
        captionOverride: drafts[p].captionOverride || null,
        title: drafts[p].title || null,
        privacy: drafts[p].privacy || null,
        ...(p === "youtube" ? { thumbnailKey: drafts[p].thumbKey } : {}),
      }));
      const res = await fetch(`/api/panel/content-posts/${postId}/publish`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoPublish, targets }),
      });
      const j = (await res.json()) as { state?: PublishState; error?: string };
      if (!res.ok || !j.state) throw new Error(j.error || "Kaydedilemedi");
      apply(j.state, true);
      return j.state;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kaydedilemedi");
      return null;
    } finally {
      setBusy(null);
    }
  }

  // Formun "Kaydet"i her render'daki güncel işlevi çağırsın.
  useEffect(() => {
    saveRef.current = saveSettings;
    return () => {
      saveRef.current = null;
    };
  });

  async function publishNow(platforms?: SocialPlatformKey[], action: "now" | "retry" = "now") {
    if (!(await saveSettings())) return;
    if (action === "now" && !await confirmDialog("Seçili platformlarda şimdi paylaşılsın mı?")) return;
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/panel/content-posts/${postId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, platforms }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error || "Paylaşım başlatılamadı");
      // Sunucu hedefleri hemen `publishing`'e çeker; yoklama oradan devam eder.
      await new Promise((r) => setTimeout(r, 800));
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Paylaşım başlatılamadı");
    } finally {
      setBusy(null);
    }
  }

  if (!state || !drafts) {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-zinc-200 px-4 py-3 text-sm text-zinc-500">
        {error ? (
          <span className="text-rose-600">{error}</span>
        ) : (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden /> Paylaşım ayarları yükleniyor…
          </>
        )}
      </div>
    );
  }

  const accountOf = new Map(state.accounts.map((a) => [a.platform, a]));
  const targetOf = new Map(state.targets.map((t) => [t.platform, t]));
  const enabled = wanted(state);
  const shown = SOCIAL_PLATFORMS.filter((p) => platforms.includes(p));
  const approved = status === "approved" || status === "published";
  const issues = enabled.flatMap((p) =>
    validateTarget(
      { platform: p, format: drafts[p].format, title: drafts[p].title },
      state.media,
      drafts[p].captionOverride.trim() || caption.trim(),
    ),
  );
  const unpublished = enabled.filter((p) => {
    const s = targetOf.get(p)?.status;
    return s !== "published" && s !== "publishing";
  });
  const past = new Date(scheduledAt).getTime() <= openedAt;
  const locked = (p: SocialPlatformKey) => {
    const s = targetOf.get(p)?.status;
    return s === "published" || s === "publishing";
  };

  return (
    <section className="mt-4 space-y-4 rounded-xl border border-zinc-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-[#141111]">Otomatik paylaşım</h4>
          <p className="mt-0.5 text-xs text-zinc-500">
            Medyayı yükleyin, formatı seçin. Metin olarak içerik metni kullanılır.
          </p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-[#141111]">
          <input
            type="checkbox"
            className="size-4 accent-[#e91825]"
            checked={autoPublish}
            disabled={!canEdit}
            onChange={(e) => {
              setAutoPublish(e.target.checked);
              setDirty(true);
            }}
          />
          Zamanı gelince otomatik paylaş
        </label>
      </div>

      {/* ── medya ── */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium text-zinc-600">
            Medya {state.media.length ? `(${state.media.length})` : ""}
            <span className="font-normal text-zinc-400"> · sıra = carousel sırası</span>
          </p>
          {canEdit ? (
            <>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={[...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_VIDEO_TYPES].join(",")}
                className="hidden"
                onChange={(e) => void uploadFiles(e.target.files)}
              />
              <button type="button" className={`${btnSecondary} !min-h-8 !px-3 !text-xs`} onClick={() => fileInput.current?.click()}>
                <Upload className="size-3.5" aria-hidden />
                Görsel / video yükle
              </button>
            </>
          ) : null}
        </div>
        {state.media.length === 0 && uploads.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 px-3 py-4 text-center text-xs text-zinc-500">
            Henüz medya yok. JPG, PNG, WebP, MP4 veya MOV yükleyin.
          </p>
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {state.media.map((m, i) => (
              <li key={m.id} className="group relative aspect-square overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
                {m.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt={m.originalName} className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <video src={m.url} className="h-full w-full object-cover" muted preload="metadata" />
                )}
                <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-[10px] font-semibold text-white">
                  {i + 1}
                </span>
                {m.kind === "video" ? (
                  <span className="absolute bottom-1 left-1 inline-flex items-center gap-0.5 rounded bg-black/60 px-1.5 text-[10px] text-white">
                    <Film className="size-3" aria-hidden />
                    {m.durationSec ? `${Math.round(m.durationSec)} sn` : "video"}
                  </span>
                ) : null}
                <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 text-[10px] text-white">
                  {fmtSize(m.sizeBytes)}
                </span>
                {canEdit ? (
                  <div className="absolute inset-x-0 top-0 flex justify-end gap-0.5 p-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                    <button type="button" aria-label="Sola taşı" className="rounded bg-white/90 p-0.5" onClick={() => void move(i, -1)} disabled={i === 0}>
                      <ChevronLeft className="size-3.5" />
                    </button>
                    <button type="button" aria-label="Sağa taşı" className="rounded bg-white/90 p-0.5" onClick={() => void move(i, 1)} disabled={i === state.media.length - 1}>
                      <ChevronRight className="size-3.5" />
                    </button>
                    <button type="button" aria-label="Sil" className="rounded bg-white/90 p-0.5 text-rose-600" disabled={busy !== null} onClick={() => void removeMedia(m)}>
                      <X className="size-3.5" />
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
            {uploads.map((u) => (
              <li key={u.id} className="relative flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-center">
                <p className="line-clamp-2 break-all text-[10px] text-zinc-600">{u.name}</p>
                {u.error ? (
                  <>
                    <p className="text-[10px] text-rose-600">{u.error}</p>
                    <button type="button" className="text-[10px] font-semibold text-zinc-600 underline" onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))}>
                      Kapat
                    </button>
                  </>
                ) : (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
                    <div className="h-full bg-[#e91825] transition-all" style={{ width: `${Math.round(u.progress * 100)}%` }} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── platformlar (formun üstünde seçilir) ── */}
      {shown.length === 0 ? (
        <p className="rounded-lg bg-zinc-50 px-3 py-2.5 text-xs text-zinc-500">
          Otomatik paylaşım için yukarıdaki “Platformlar” bölümünden Instagram veya Facebook seçin.
        </p>
      ) : null}
      <ul className="space-y-2">
        {shown.map((p) => {
          const d = { ...drafts[p], enabled: enabled.includes(p) };
          const account = accountOf.get(p);
          const target = targetOf.get(p);
          const ready = PUBLISHER_READY[p];
          const isLocked = locked(p);
          return (
            <li key={p} className={`rounded-lg border px-3 py-2.5 ${d.enabled ? "border-zinc-300 bg-white" : "border-zinc-200 bg-zinc-50"}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className={`inline-flex items-center gap-2 text-sm font-medium ${account && ready ? "text-[#141111]" : "text-zinc-400"}`}>
                  <SocialIcon platform={p} brand={Boolean(account && ready)} className="size-4" />
                  {SOCIAL_PLATFORM_LABEL[p]}
                </span>
                <span className="min-w-0 truncate text-xs text-zinc-500">
                  {!ready ? (
                    "Otomatik paylaşım yakında — elle paylaşılır"
                  ) : account ? (
                    account.username ? `@${account.username}` : account.name
                  ) : (
                    <a href={`/brands/${tenantSlug}#sosyal-hesaplar`} className="text-[#e91825] hover:underline">
                      Hesap bağlı değil — bağla
                    </a>
                  )}
                </span>
                {d.enabled ? (
                  <select
                    className={`${fieldClass} !min-h-8 !py-1 text-xs`}
                    value={d.format}
                    disabled={!canEdit || isLocked}
                    onChange={(e) => patchDraft(p, { format: e.target.value as PublishFormat })}
                  >
                    {PLATFORM_FORMATS[p].map((f) => (
                      <option key={f} value={f}>
                        {FORMAT_LABEL[f]}
                      </option>
                    ))}
                  </select>
                ) : null}
                {target ? (
                  <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLASS[target.status]}`}>
                    {target.status === "publishing" ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
                    {PUBLISH_STATUS_LABEL[target.status]}
                    {target.status === "published" && target.publishedAt ? ` · ${fmtDateTime(target.publishedAt)}` : ""}
                    {target.status === "pending" && target.nextAttemptAt ? ` · tekrar ${fmtDateTime(target.nextAttemptAt)}` : ""}
                  </span>
                ) : null}
              </div>

              {d.enabled && !isLocked ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {p === "youtube" ? (
                    <input
                      className={`${fieldClass} w-full text-sm sm:col-span-2`}
                      placeholder="YouTube başlığı (zorunlu)"
                      maxLength={100}
                      value={d.title}
                      disabled={!canEdit}
                      onChange={(e) => patchDraft(p, { title: e.target.value })}
                    />
                  ) : null}
                  {p === "youtube" && d.format === "video" ? (
                    <div className="text-xs text-zinc-600 sm:col-span-2">
                      <p>
                        Kapak görseli <span className="text-zinc-400">· isteğe bağlı · 16:9, en az 640 px genişlik</span>
                      </p>
                      <input
                        ref={thumbInput}
                        type="file"
                        accept={ACCEPTED_IMAGE_TYPES.join(",")}
                        className="hidden"
                        onChange={(e) => void uploadThumb(e.target.files?.[0])}
                      />
                      <div className="mt-1 flex items-center gap-2">
                        {d.thumbUrl ? (
                          <div className="relative aspect-video w-36 overflow-hidden rounded-lg bg-zinc-100">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={d.thumbUrl} alt="Kapak" className="h-full w-full object-cover" />
                            {canEdit ? (
                              <button
                                type="button"
                                aria-label="Kapağı kaldır"
                                className="absolute right-1 top-1 rounded-full bg-white/90 p-0.5 text-rose-600"
                                onClick={() => patchDraft(p, { thumbKey: null, thumbUrl: null })}
                              >
                                <X className="size-3.5" />
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                        {canEdit ? (
                          <button
                            type="button"
                            disabled={busy === "thumb"}
                            onClick={() => thumbInput.current?.click()}
                            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 hover:ring-zinc-400 disabled:opacity-50"
                          >
                            {busy === "thumb" ? (
                              <Loader2 className="size-3.5 animate-spin" aria-hidden />
                            ) : (
                              <Upload className="size-3.5" aria-hidden />
                            )}
                            {d.thumbUrl ? "Değiştir" : "Kapak seç"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  {PRIVACY_OPTIONS[p] ? (
                    <select
                      className={`${fieldClass} w-full text-sm`}
                      value={d.privacy}
                      disabled={!canEdit}
                      onChange={(e) => patchDraft(p, { privacy: e.target.value })}
                    >
                      {PRIVACY_OPTIONS[p]!.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <details className="sm:col-span-2" open={Boolean(d.captionOverride)}>
                    <summary className="cursor-pointer text-xs text-zinc-500">Bu platforma özel metin</summary>
                    <textarea
                      className="mt-1 min-h-16 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-[#141111] focus:border-[#141111] focus:outline-none"
                      placeholder="Boş bırakılırsa içerik metni kullanılır"
                      value={d.captionOverride}
                      disabled={!canEdit}
                      onChange={(e) => patchDraft(p, { captionOverride: e.target.value })}
                    />
                  </details>
                </div>
              ) : null}

              {target?.permalink ? (
                <a href={target.permalink} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs text-[#e91825] hover:underline">
                  <ExternalLink className="size-3.5" aria-hidden />
                  Paylaşımı aç
                </a>
              ) : null}
              {target?.lastError && target.status !== "published" ? (
                <div className="mt-1.5 flex flex-wrap items-start gap-2 text-xs text-rose-700">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 break-words">{target.lastError}</span>
                  {canEdit && target.status === "failed" ? (
                    <button type="button" className="inline-flex items-center gap-1 font-semibold text-[#141111] hover:underline" disabled={busy !== null} onClick={() => void publishNow([p], "retry")}>
                      <RotateCcw className="size-3.5" aria-hidden />
                      Tekrar dene
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {issues.length ? (
        <ul className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {issues.map((m) => (
            <li key={m}>• {m}</li>
          ))}
        </ul>
      ) : null}
      {autoPublish && !approved && unpublished.length > 0 ? (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">
          Otomatik paylaşım için içeriğin durumunu <strong>Onaylandı</strong> yapın. Onaylanana kadar zamanı gelse de
          paylaşılmaz.
        </p>
      ) : null}
      {autoPublish && approved && past && unpublished.length > 0 ? (
        <p className="text-xs text-amber-800">
          Paylaşım tarihi geçmiş — kaydedince bir dakika içinde paylaşılır.
        </p>
      ) : null}
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={btnPrimary}
            disabled={busy !== null || unpublished.length === 0 || issues.length > 0 || unsaved || inFlight}
            title={unsaved ? "Önce Kaydet'e basın" : undefined}
            onClick={() => void publishNow(unpublished)}
          >
            {busy === "now" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
            Şimdi paylaş
          </button>
          {unsaved ? <span className="text-xs text-zinc-500">Kaydedilmemiş değişiklik var — önce Kaydet.</span> : null}
          {busy === "save" ? <span className="text-xs text-zinc-500">Paylaşım ayarları kaydediliyor…</span> : null}
        </div>
      ) : null}
    </section>
  );
}
