"use client";

import DatePicker from "@/components/panel/ds/DatePicker";

import { confirmDialog } from "@/components/panel/ds/confirm";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ContentPostStatus } from "@prisma/client";
import {
  AlertTriangle,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Film,
  ImagePlus,
  Loader2,
  Send,
  X,
} from "lucide-react";
import { fieldClass, toolPrimary } from "@/components/panel/ds/buttons";
import { SocialIcon } from "@/components/panel/ds/social-icons";
import type { SerializedPost } from "@/lib/panel/content-posts";
import {
  ACCEPTED_IMAGE_TYPES,
  ACCEPTED_VIDEO_TYPES,
  CAPTION_LIMIT,
  defaultFormat,
  FORMAT_LABEL,
  isSocialPlatform,
  MAX_IMAGE_BYTES,
  MAX_MEDIA_PER_POST,
  MAX_VIDEO_BYTES,
  PLATFORM_FORMATS,
  PUBLISHER_READY,
  SOCIAL_PLATFORM_LABEL,
  validateTarget,
  type MediaShape,
  type PublishFormat,
  type SocialPlatformKey,
} from "@/lib/social/formats";
import type { AccountMatrixRow } from "@/lib/social/overview";
import type { PublishState, SerializedMedia, SerializedTarget } from "@/lib/social/state";

/** Paylaşımlar'dan paylaşılabilen platformlar (yayın motoru hazır olanlar). */
const PLATFORMS = (["instagram", "facebook"] as const).filter((p) => PUBLISHER_READY[p]);

type Mode = "now" | "schedule";

/** Penceredeki medya: kayıtlı (sunucuda) ya da henüz yüklenmemiş (yerel dosya). */
type Item = {
  key: string;
  kind: "image" | "video";
  url: string;
  name: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
} & ({ remoteId: string; file?: undefined } | { remoteId?: undefined; file: File });

type PlatformDraft = { format: PublishFormat; captionOverride: string };

type Phase =
  | { kind: "loading" }
  | { kind: "edit" }
  | { kind: "working"; step: string }
  | { kind: "done-now"; postId: string; targets: SerializedTarget[] }
  | { kind: "done-plan"; postId: string; at: string; approved: boolean; issues: string[] }
  | { kind: "failed"; postId: string | null; message: string };

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** Varsayılan plan zamanı: en az bir saat sonrası, sonraki tam saate yuvarlanmış. */
function defaultWhen(): string {
  const d = new Date(Date.now() + 60 * 60_000);
  if (d.getMinutes() || d.getSeconds()) d.setHours(d.getHours() + 1);
  d.setMinutes(0, 0, 0);
  return toLocalInput(d);
}
function connectedOf(b: AccountMatrixRow): SocialPlatformKey[] {
  return PLATFORMS.filter((p) => Boolean(b.accounts[p]));
}
const whenFmt = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  weekday: "long",
  hour: "2-digit",
  minute: "2-digit",
});

function fileInfo(file: File): Promise<Pick<Item, "width" | "height" | "durationSec">> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const done = (v: Pick<Item, "width" | "height" | "durationSec">) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    if (file.type.startsWith("video/")) {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => done({ width: v.videoWidth, height: v.videoHeight, durationSec: v.duration });
      v.onerror = () => done({ width: null, height: null, durationSec: null });
      v.src = url;
    } else {
      const img = new Image();
      img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight, durationSec: null });
      img.onerror = () => done({ width: null, height: null, durationSec: null });
      img.src = url;
    }
  });
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

async function json<T>(res: Response, fallback: string): Promise<T> {
  const j = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !j) throw new Error(j?.error || fallback);
  return j;
}

function remoteItem(m: SerializedMedia): Item {
  return {
    key: m.id,
    remoteId: m.id,
    kind: m.kind,
    url: m.url,
    name: m.originalName,
    width: m.width,
    height: m.height,
    durationSec: m.durationSec,
  };
}

/**
 * Paylaşımlar penceresi: marka, platform, medya, açıklama, format ve zamanlama
 * tek yerden. Yeni paylaşım ya da mevcut planı (`postId`) düzenleme.
 * "Şimdi paylaş" anında gönderir; "Planla" seçilen saatte otomatik paylaşılmak
 * üzere kaydeder — medya / açıklama sonradan eklenebilir, ama ikisi olmadan
 * paylaşım yapılmaz. Kayıt içerik takvimindeki içerikle aynıdır.
 */
export default function SocialComposer({
  brands,
  postId: initialPostId = null,
  onClose,
  onChanged,
}: {
  /** Meta hesabı bağlı markalar. */
  brands: AccountMatrixRow[];
  /** Verilirse mevcut paylaşım planı düzenlenir. */
  postId?: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const only = brands.length === 1 ? brands[0]! : null;
  const [postId, setPostId] = useState<string | null>(initialPostId);
  const [tenantId, setTenantId] = useState(only?.tenantId ?? "");
  const [tenantName, setTenantName] = useState(only?.tenantName ?? "");
  const [platforms, setPlatforms] = useState<SocialPlatformKey[]>(only ? connectedOf(only) : []);
  const [items, setItems] = useState<Item[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [drafts, setDrafts] = useState<Partial<Record<SocialPlatformKey, PlatformDraft>>>({});
  const [mode, setMode] = useState<Mode>(initialPostId ? "schedule" : "now");
  const [when, setWhen] = useState(defaultWhen);
  const [status, setStatus] = useState<ContentPostStatus>("approved");
  const [title, setTitle] = useState("");
  const [live, setLive] = useState<SerializedTarget[]>([]);
  const [phase, setPhase] = useState<Phase>(initialPostId ? { kind: "loading" } : { kind: "edit" });
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const blobUrls = useRef<string[]>([]);
  /** Plan saati kontrolü için "şimdi" — yarım dakikada bir tazelenir. */
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const brand = brands.find((b) => b.tenantId === tenantId) ?? null;
  const editing = Boolean(postId);
  const working = phase.kind === "working";
  /** Yayında / yayınlanıyor hedef varsa pencere salt okunur. */
  const locked = live.some((t) => t.status === "published" || t.status === "publishing");

  // Mevcut planı yükle.
  useEffect(() => {
    if (!initialPostId) return;
    let alive = true;
    (async () => {
      try {
        const { state } = await json<{ state: PublishState }>(
          await fetch(`/api/panel/content-posts/${initialPostId}/publish`, { cache: "no-store" }),
          "Paylaşım yüklenemedi",
        );
        if (!alive) return;
        const p = state.post;
        setTenantId(p.tenantId);
        setTenantName(p.tenantName);
        setPlatforms(p.platforms.filter(isSocialPlatform).filter((x) => PUBLISHER_READY[x]));
        setItems(state.media.map(remoteItem));
        setCaption(p.caption);
        setTitle(p.title);
        setWhen(toLocalInput(new Date(p.scheduledAt)));
        setStatus(p.status === "approved" ? "approved" : "review");
        setDrafts(
          Object.fromEntries(
            state.targets.map((t) => [t.platform, { format: t.format, captionOverride: t.captionOverride ?? "" }]),
          ),
        );
        setLive(state.targets);
        setPhase({ kind: "edit" });
      } catch (err) {
        if (alive) setPhase({ kind: "failed", postId: initialPostId, message: err instanceof Error ? err.message : "Paylaşım yüklenemedi" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [initialPostId]);

  // Yerel önizleme bağlantıları pencere kapanınca bırakılır.
  useEffect(() => () => blobUrls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !working) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, working]);

  const shapes: MediaShape[] = useMemo(
    () => items.map((m) => ({ kind: m.kind, width: m.width, height: m.height, durationSec: m.durationSec })),
    [items],
  );
  const formatOf = (p: SocialPlatformKey): PublishFormat => drafts[p]?.format ?? defaultFormat(p, shapes);
  const captionOf = (p: SocialPlatformKey) => drafts[p]?.captionOverride.trim() || caption.trim();
  /** Seçili tüm platformlarda hikâye → açıklama alanı gizlenir. */
  const onlyStory = platforms.length > 0 && platforms.every((p) => formatOf(p) === "story");

  /** Kaydetmeyi engelleyen eksikler. */
  const blockers: string[] = [];
  if (!tenantId) blockers.push("Marka seçin.");
  if (!platforms.length) blockers.push("En az bir platform seçin.");
  if (mode === "schedule") {
    const at = new Date(when);
    if (Number.isNaN(at.getTime())) blockers.push("Geçerli bir paylaşım tarihi girin.");
    else if (at.getTime() < nowMs + 2 * 60_000)
      blockers.push("Plan saati en az birkaç dakika sonrası olmalı — hemen paylaşmak için “Şimdi paylaş”ı seçin.");
  }
  /** Paylaşımı engelleyen eksikler (medya, açıklama, format kuralları). */
  const publishIssues = [
    ...new Set(platforms.flatMap((p) => validateTarget({ platform: p, format: formatOf(p) }, shapes, captionOf(p)))),
  ];
  // Şimdi paylaş: her şey tam olmalı. Planla: eksikle kaydedilebilir, ama paylaşılmaz.
  const canSubmit = !working && !locked && blockers.length === 0 && (mode === "schedule" || publishIssues.length === 0);

  async function addFiles(list: FileList | null) {
    setFileError(null);
    if (!list?.length) return;
    const accepted = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_VIDEO_TYPES];
    const next: Item[] = [];
    for (const file of Array.from(list)) {
      if (!accepted.includes(file.type)) {
        setFileError(`${file.name}: desteklenmeyen dosya (JPG, PNG, WebP, MP4, MOV).`);
        continue;
      }
      const kind = file.type.startsWith("video/") ? "video" : "image";
      if (file.size > (kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)) {
        setFileError(`${file.name}: dosya çok büyük.`);
        continue;
      }
      const url = URL.createObjectURL(file);
      blobUrls.current.push(url);
      next.push({ key: `${Date.now()}-${Math.random()}`, file, kind, url, name: file.name, ...(await fileInfo(file)) });
    }
    setItems((m) => [...m, ...next].slice(0, MAX_MEDIA_PER_POST));
    if (fileInput.current) fileInput.current.value = "";
  }

  function move(i: number, dir: -1 | 1) {
    setItems((m) => {
      const j = i + dir;
      if (j < 0 || j >= m.length) return m;
      const n = [...m];
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });
  }

  function removeItem(it: Item) {
    setItems((x) => x.filter((y) => y.key !== it.key));
    if (it.remoteId) setRemoved((r) => [...r, it.remoteId!]);
  }

  function patchDraft(p: SocialPlatformKey, patch: Partial<PlatformDraft>) {
    setDrafts((d) => ({ ...d, [p]: { format: formatOf(p), captionOverride: d[p]?.captionOverride ?? "", ...patch } }));
  }

  /** İçerik → medya (sil / yükle / sırala) → hedefler → (şimdi ise) paylaş. */
  async function submit() {
    if (!canSubmit) return;
    if (
      mode === "now" &&
      !await confirmDialog(`${platforms.map((p) => SOCIAL_PLATFORM_LABEL[p]).join(" ve ")} hesabında şimdi paylaşılsın mı?`)
    )
      return;
    let id = postId;
    try {
      const at = mode === "now" ? new Date() : new Date(when);
      const body = {
        title: title.trim() || caption.trim().replace(/\s+/g, " ").slice(0, 60),
        caption,
        platforms,
        scheduledAt: at.toISOString(),
        status: mode === "now" ? "approved" : status,
      };
      setPhase({ kind: "working", step: id ? "Kaydediliyor…" : "Paylaşım oluşturuluyor…" });
      if (id) {
        await json(
          await fetch(`/api/panel/content-posts/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
          "Kaydedilemedi",
        );
      } else {
        const created = await json<{ post: SerializedPost }>(
          await fetch("/api/panel/content-posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tenantId, ...body }),
          }),
          "Paylaşım oluşturulamadı",
        );
        id = created.post.id;
        setPostId(id);
      }
      onChanged();

      for (const mediaId of removed) {
        await fetch(`/api/panel/content-posts/${id}/media/${mediaId}`, { method: "DELETE" });
      }
      setRemoved([]);

      const order: string[] = [];
      const local = items.filter((m) => m.file);
      let n = 0;
      for (const m of items) {
        if (m.remoteId) {
          order.push(m.remoteId);
          continue;
        }
        n++;
        const label = `Medya yükleniyor ${n}/${local.length}`;
        setPhase({ kind: "working", step: `${label}…` });
        const pre = await json<{ key: string; uploadUrl: string }>(
          await fetch(`/api/panel/content-posts/${id}/media`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mime: m.file!.type, size: m.file!.size }),
          }),
          `${m.name}: yükleme başlatılamadı`,
        );
        await putWithProgress(pre.uploadUrl, m.file!, (p) =>
          setPhase({ kind: "working", step: `${label} · %${Math.round(p * 100)}` }),
        );
        const done = await json<{ media: SerializedMedia }>(
          await fetch(`/api/panel/content-posts/${id}/media/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              key: pre.key,
              mime: m.file!.type,
              name: m.name,
              width: m.width,
              height: m.height,
              durationSec: m.durationSec,
            }),
          }),
          `${m.name}: yükleme tamamlanamadı`,
        );
        order.push(done.media.id);
        // Yüklenen dosya artık kayıtlı — hata olursa tekrar yüklenmesin.
        const uploaded = remoteItem(done.media);
        setItems((list) => list.map((x) => (x.key === m.key ? { ...uploaded, url: x.url } : x)));
      }
      if (order.length > 1) {
        await fetch(`/api/panel/content-posts/${id}/media`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order }),
        });
      }

      setPhase({ kind: "working", step: "Paylaşım ayarları kaydediliyor…" });
      const { state } = await json<{ state: PublishState }>(
        await fetch(`/api/panel/content-posts/${id}/publish`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            autoPublish: mode === "schedule",
            targets: platforms.map((p) => ({
              platform: p,
              format: formatOf(p),
              captionOverride: drafts[p]?.captionOverride.trim() || null,
            })),
          }),
        }),
        "Paylaşım ayarları kaydedilemedi",
      );
      setLive(state.targets);

      if (mode === "schedule") {
        setPhase({
          kind: "done-plan",
          postId: id,
          at: at.toISOString(),
          approved: status === "approved",
          issues: publishIssues,
        });
        onChanged();
        return;
      }

      setPhase({ kind: "working", step: "Paylaşılıyor… (video işleme birkaç dakika sürebilir)" });
      await json(
        await fetch(`/api/panel/content-posts/${id}/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "now", platforms }),
        }),
        "Paylaşım başlatılamadı",
      );
      // Sonuç gelene kadar yokla (en çok ~15 dk).
      const started = Date.now();
      let last: SerializedTarget[] = [];
      while (Date.now() - started < 15 * 60_000) {
        await new Promise((r) => setTimeout(r, 3000));
        const r = await json<{ state: PublishState }>(
          await fetch(`/api/panel/content-posts/${id}/publish`, { cache: "no-store" }),
          "Durum alınamadı",
        );
        last = r.state.targets;
        if (!last.some((t) => t.status === "publishing" || t.status === "pending")) break;
      }
      setLive(last);
      setPhase({ kind: "done-now", postId: id, targets: last });
      onChanged();
    } catch (err) {
      setPhase({ kind: "failed", postId: id, message: err instanceof Error ? err.message : "İşlem tamamlanamadı" });
      onChanged();
    }
  }

  /* ───────────── sonuç ekranları ───────────── */

  const targetList = (targets: SerializedTarget[]) => (
    <ul className="space-y-2">
      {targets.map((t) => (
        <li key={t.platform} className="flex flex-wrap items-start gap-2 rounded-xl bg-zinc-50 px-3 py-2.5 text-sm">
          <SocialIcon platform={t.platform} brand className="mt-0.5 size-4" />
          <span className="font-medium">{SOCIAL_PLATFORM_LABEL[t.platform]}</span>
          <span className="text-xs text-zinc-500">{FORMAT_LABEL[t.format]}</span>
          {t.status === "published" ? (
            t.permalink ? (
              <a href={t.permalink} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-emerald-700 hover:underline">
                Paylaşıldı — aç <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ) : (
              <span className="ml-auto text-emerald-700">Paylaşıldı</span>
            )
          ) : t.status === "failed" ? (
            <span className="w-full break-words text-xs text-rose-700">{t.lastError || "Hata"}</span>
          ) : t.status === "publishing" ? (
            <span className="ml-auto inline-flex items-center gap-1 text-amber-700">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Paylaşılıyor
            </span>
          ) : (
            <span className="ml-auto text-zinc-500">Sırada</span>
          )}
        </li>
      ))}
    </ul>
  );

  let result: React.ReactNode = null;
  if (phase.kind === "done-now") {
    const failed = phase.targets.filter((t) => t.status === "failed").length;
    result = (
      <div className="space-y-3">
        <p className={`text-sm font-medium ${failed ? "text-rose-700" : "text-emerald-700"}`}>
          {failed ? (failed === phase.targets.length ? "Paylaşım başarısız oldu." : "Paylaşım kısmen tamamlandı.") : "Paylaşıldı."}
        </p>
        {targetList(phase.targets)}
        {failed ? (
          <p className="text-xs text-zinc-500">Hatalı platformu Paylaşımlar → Hatalı sekmesinden tekrar deneyebilirsiniz.</p>
        ) : null}
      </div>
    );
  } else if (phase.kind === "done-plan") {
    result = (
      <div className="space-y-2 text-sm">
        <p className="font-medium text-emerald-700">Planlandı: {whenFmt.format(new Date(phase.at))}</p>
        {phase.issues.length ? (
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div>
              <p>Şu eksikler tamamlanmadan paylaşılmaz:</p>
              <ul className="mt-1 list-disc pl-4 text-xs">
                {phase.issues.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
              <p className="mt-1 text-xs">Paylaşımlar listesinde bu plana tıklayıp tamamlayabilirsiniz.</p>
            </div>
          </div>
        ) : phase.approved ? (
          <p className="text-zinc-600">Saati gelince otomatik paylaşılacak. İçerik takviminde de görünür.</p>
        ) : (
          <p className="text-zinc-600">“Onayda” — onaylanınca saatinde otomatik paylaşılır. İçerik takviminde de görünür.</p>
        )}
      </div>
    );
  } else if (phase.kind === "failed") {
    result = (
      <div className="space-y-2 text-sm">
        <p className="flex items-start gap-2 font-medium text-rose-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {phase.message}
        </p>
        {phase.postId ? (
          <p className="text-zinc-600">Paylaşım planı kaydedildi; eksik kısmı düzeltip tekrar deneyebilirsiniz.</p>
        ) : null}
        <button
          type="button"
          onClick={() => setPhase({ kind: "edit" })}
          className="text-sm font-medium text-zinc-800 underline-offset-2 hover:underline"
        >
          Geri dön ve düzelt
        </button>
      </div>
    );
  }

  const finished = phase.kind === "done-now" || phase.kind === "done-plan" || phase.kind === "failed";
  const resultPostId = finished ? phase.postId : postId;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !working) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="composer-title"
        className="flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white text-zinc-900 shadow-2xl sm:rounded-2xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3.5">
          <div className="min-w-0">
            <h3 id="composer-title" className="text-base font-semibold">
              {editing ? "Paylaşım" : "Yeni paylaşım"}
            </h3>
            {editing && tenantName ? <p className="truncate text-xs text-zinc-500">{tenantName}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={working}
            aria-label="Kapat"
            className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-40"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {phase.kind === "loading" ? (
            <p className="flex items-center justify-center gap-2 py-14 text-sm text-zinc-500">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Yükleniyor…
            </p>
          ) : finished ? (
            result
          ) : brands.length === 0 && !editing ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              Meta hesabı bağlı marka yok. Önce Hesaplar sekmesinden bağlayın.
            </p>
          ) : locked ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-600">Bu paylaşım yayında — düzenlenemez. Kaldırmak için listedeki “Sil”i kullanın.</p>
              {targetList(live)}
            </div>
          ) : (
            <fieldset disabled={working} className="space-y-5">
              {/* marka + platform */}
              <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
                <label className="text-xs text-zinc-600">
                  Marka
                  <select
                    className={`${fieldClass} mt-1 w-full`}
                    value={tenantId}
                    disabled={editing}
                    onChange={(e) => {
                      const b = brands.find((x) => x.tenantId === e.target.value);
                      setTenantId(e.target.value);
                      setTenantName(b?.tenantName ?? "");
                      setPlatforms(b ? connectedOf(b) : []);
                    }}
                  >
                    <option value="">Seçin</option>
                    {brands.map((b) => (
                      <option key={b.tenantId} value={b.tenantId}>
                        {b.tenantName}
                      </option>
                    ))}
                    {editing && !brand ? <option value={tenantId}>{tenantName}</option> : null}
                  </select>
                </label>
                <div className="text-xs text-zinc-600">
                  <p>Platformlar</p>
                  <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="Platformlar">
                    {PLATFORMS.map((p) => {
                      const on = platforms.includes(p);
                      const account = brand?.accounts[p];
                      return (
                        <button
                          key={p}
                          type="button"
                          aria-pressed={on}
                          disabled={!account}
                          title={account ? account.label : "Bu markada hesap bağlı değil"}
                          onClick={() => setPlatforms(on ? platforms.filter((x) => x !== p) : [...platforms, p])}
                          className={`inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                            on ? "bg-[#141111] text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200/70"
                          }`}
                        >
                          <span className={`flex size-5 items-center justify-center rounded-full ${on ? "bg-white" : ""}`}>
                            <SocialIcon platform={p} brand className="size-3.5" />
                          </span>
                          {SOCIAL_PLATFORM_LABEL[p]}
                          {account ? (
                            <span className={`max-w-[9rem] truncate text-xs ${on ? "text-white/70" : "text-zinc-500"}`}>
                              {account.label}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* medya */}
              <div>
                <p className="mb-1.5 text-xs text-zinc-600">
                  Medya {items.length ? `(${items.length})` : ""}
                  <span className="text-zinc-400"> · sıra = carousel sırası{mode === "schedule" ? " · sonradan da eklenebilir" : ""}</span>
                </p>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept={[...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_VIDEO_TYPES].join(",")}
                  className="hidden"
                  onChange={(e) => void addFiles(e.target.files)}
                />
                <div
                  className="grid grid-cols-3 gap-2 sm:grid-cols-5"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    void addFiles(e.dataTransfer.files);
                  }}
                >
                  {items.map((m, i) => (
                    <div key={m.key} className="group relative aspect-square overflow-hidden rounded-xl bg-zinc-100">
                      {m.kind === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.url} alt={m.name} className="h-full w-full object-cover" />
                      ) : (
                        <video src={m.url} className="h-full w-full object-cover" muted preload="metadata" />
                      )}
                      <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-1.5 text-[10px] font-semibold text-white">
                        {i + 1}
                      </span>
                      {m.kind === "video" ? (
                        <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 text-[10px] text-white">
                          <Film className="size-3" aria-hidden />
                          {m.durationSec ? `${Math.round(m.durationSec)} sn` : "video"}
                        </span>
                      ) : null}
                      <div className="absolute inset-x-0 top-0 flex justify-end gap-0.5 p-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                        <button type="button" aria-label="Sola taşı" className="rounded-full bg-white/90 p-0.5" onClick={() => move(i, -1)} disabled={i === 0}>
                          <ChevronLeft className="size-3.5" />
                        </button>
                        <button type="button" aria-label="Sağa taşı" className="rounded-full bg-white/90 p-0.5" onClick={() => move(i, 1)} disabled={i === items.length - 1}>
                          <ChevronRight className="size-3.5" />
                        </button>
                        <button type="button" aria-label="Kaldır" className="rounded-full bg-white/90 p-0.5 text-rose-600" onClick={() => removeItem(m)}>
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {items.length < MAX_MEDIA_PER_POST ? (
                    <button
                      type="button"
                      onClick={() => fileInput.current?.click()}
                      className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-zinc-200 text-xs text-zinc-500 transition hover:border-zinc-400 hover:text-zinc-800 ${
                        items.length === 0 ? "col-span-3 py-8 sm:col-span-5" : "aspect-square"
                      }`}
                    >
                      <ImagePlus className="size-5" aria-hidden />
                      {items.length === 0 ? "Görsel / video seçin ya da buraya sürükleyin" : "Ekle"}
                    </button>
                  ) : null}
                </div>
                {fileError ? <p className="mt-1.5 text-xs text-rose-700">{fileError}</p> : null}
              </div>

              {/* paylaşım türü — açıklamadan önce seçilir */}
              {platforms.length ? (
                <div className="space-y-2">
                  {platforms.map((p) => (
                    <div key={p} className="rounded-xl bg-zinc-50 px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <SocialIcon platform={p} brand className="size-4" />
                        <span className="text-sm font-medium">{SOCIAL_PLATFORM_LABEL[p]}</span>
                        <div className="ml-auto flex gap-1" role="radiogroup" aria-label={`${SOCIAL_PLATFORM_LABEL[p]} formatı`}>
                          {PLATFORM_FORMATS[p].map((f) => {
                            const on = formatOf(p) === f;
                            return (
                              <button
                                key={f}
                                type="button"
                                role="radio"
                                aria-checked={on}
                                onClick={() => patchDraft(p, { format: f })}
                                className={`h-7 rounded-full px-3 text-xs font-medium transition ${
                                  on ? "bg-[#141111] text-white" : "bg-white text-zinc-600 hover:text-zinc-900"
                                }`}
                              >
                                {FORMAT_LABEL[f]}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      {formatOf(p) === "story" ? (
                        <p className="mt-1.5 text-xs text-zinc-500">Hikâyede açıklama paylaşılmaz; yalnızca tek görsel veya video gider.</p>
                      ) : onlyStory ? null : (
                      <details className="mt-1.5" open={Boolean(drafts[p]?.captionOverride)}>
                        <summary className="cursor-pointer text-xs text-zinc-500">Bu platforma özel açıklama</summary>
                        <textarea
                          className="mt-1 min-h-16 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-[#141111] focus:outline-none"
                          placeholder="Boş bırakılırsa ortak açıklama kullanılır"
                          value={drafts[p]?.captionOverride ?? ""}
                          onChange={(e) => patchDraft(p, { captionOverride: e.target.value })}
                        />
                      </details>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}

              {/* açıklama — yalnızca hikâye seçiliyse gizli */}
              {onlyStory ? null : (
              <label className="block text-xs text-zinc-600">
                <span className="flex items-baseline justify-between">
                  Açıklama
                  {platforms.includes("instagram") ? (
                    <span className={`tabular-nums ${caption.length > CAPTION_LIMIT.instagram ? "text-rose-600" : "text-zinc-400"}`}>
                      {caption.length} / {CAPTION_LIMIT.instagram}
                    </span>
                  ) : null}
                </span>
                <textarea
                  className="mt-1 min-h-32 w-full rounded-2xl border border-zinc-300 bg-white px-4 py-3 text-sm leading-relaxed text-[#141111] focus:border-[#141111] focus:outline-none"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Paylaşım açıklaması, hashtag'ler, emojiler…"
                />
              </label>
              )}

              {/* zamanlama */}
              <div className="space-y-3 rounded-2xl border border-zinc-200 p-3">
                <div className="flex rounded-full bg-zinc-100 p-1" role="radiogroup" aria-label="Ne zaman">
                  {(
                    [
                      { key: "now", label: "Şimdi paylaş", Icon: Send },
                      { key: "schedule", label: "Planla", Icon: CalendarClock },
                    ] as const
                  ).map(({ key, label, Icon }) => {
                    const on = mode === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setMode(key)}
                        className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full text-sm font-medium transition ${
                          on ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"
                        }`}
                      >
                        <Icon className="size-4" aria-hidden />
                        {label}
                      </button>
                    );
                  })}
                </div>
                {mode === "schedule" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs text-zinc-600">
                      Paylaşım tarihi ve saati
                      <DatePicker mode="datetime" className={`${fieldClass} mt-1 w-full`} value={when} onChange={setWhen} min={new Date().toISOString().slice(0, 10)} required />
                    </label>
                    <label className="text-xs text-zinc-600">
                      Onay
                      <select className={`${fieldClass} mt-1 w-full`} value={status} onChange={(e) => setStatus(e.target.value as ContentPostStatus)}>
                        <option value="approved">Onaylandı — saatinde paylaşılsın</option>
                        <option value="review">Onayda — onay bekleyecek</option>
                      </select>
                    </label>
                    <label className="text-xs text-zinc-600 sm:col-span-2">
                      Takvim başlığı <span className="text-zinc-400">(isteğe bağlı, paylaşılmaz)</span>
                      <input
                        className={`${fieldClass} mt-1 w-full`}
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Boşsa açıklamanın başı kullanılır"
                      />
                    </label>
                  </div>
                ) : (
                  <p className="px-1 text-xs text-zinc-500">
                    Onaylayınca hemen paylaşılır. Paylaşım içerik takvimine de bugünün tarihiyle eklenir.
                  </p>
                )}
              </div>
            </fieldset>
          )}
        </div>

        <div className="shrink-0 space-y-2 border-t border-zinc-100 px-5 py-3">
          {phase.kind === "edit" && !locked && (blockers.length || publishIssues.length) ? (
            <ul className="space-y-0.5 text-xs">
              {blockers.map((m) => (
                <li key={m} className="text-amber-800">
                  • {m}
                </li>
              ))}
              {publishIssues.map((m) => (
                <li key={m} className={mode === "now" ? "text-amber-800" : "text-zinc-500"}>
                  • {m}
                  {mode === "schedule" ? " (plan kaydedilir, tamamlanmadan paylaşılmaz)" : ""}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            {working ? (
              <p className="inline-flex items-center gap-2 text-xs text-zinc-600">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {phase.step}
              </p>
            ) : null}
            {resultPostId && !working ? (
              <Link href={`/takvim?post=${resultPostId}`} className="text-xs font-medium text-zinc-700 underline-offset-2 hover:underline">
                Takvimde aç
              </Link>
            ) : null}
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={working}
                className="inline-flex h-9 items-center rounded-full px-4 text-sm text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40"
              >
                Kapat
              </button>
              {(phase.kind === "edit" || working) && !locked ? (
                <button type="button" onClick={() => void submit()} disabled={!canSubmit} className={`${toolPrimary} !h-9 !px-5 !text-sm`}>
                  {working ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : mode === "now" ? (
                    <Send className="size-4" aria-hidden />
                  ) : (
                    <CalendarClock className="size-4" aria-hidden />
                  )}
                  {mode === "now" ? "Şimdi paylaş" : editing ? "Kaydet" : "Planla"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
