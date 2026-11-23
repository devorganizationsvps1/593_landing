"use client";

import {
  Check,
  ClipboardPaste,
  Copy,
  ImagePlus,
  Lock,
  NotebookPen,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  Unlock,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { btnPrimary, fieldClass } from "@/components/panel/ds/buttons";
import { RichText } from "@/components/panel/RichText";
import {
  STAFF_NOTE_BODY_MAX,
  STAFF_NOTE_TITLE_MAX,
  type SerializedStaffNote,
} from "@/lib/panel/staff-notes";

const IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]);
const SAVE_DELAY_MS = 700;

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

function sortNotes(list: SerializedStaffNote[]): SerializedStaffNote[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

const fmt = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Istanbul",
});

function authorLabel(n: SerializedStaffNote): string {
  return n.author?.name || n.author?.email || "—";
}

export default function StaffNotesBoard({
  initial,
  currentUserId,
}: {
  initial: SerializedStaffNote[];
  currentUserId: string | null;
}) {
  const [notes, setNotes] = useState(() => sortNotes(initial));
  const [activeId, setActiveId] = useState<string | null>(initial[0]?.id ?? null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = notes.find((n) => n.id === activeId) ?? null;

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    if (!q) return notes;
    return notes.filter(
      (n) =>
        n.title.toLocaleLowerCase("tr").includes(q) ||
        n.body.toLocaleLowerCase("tr").includes(q),
    );
  }, [notes, query]);

  const upsert = useCallback((note: SerializedStaffNote) => {
    setNotes((prev) => sortNotes(prev.map((n) => (n.id === note.id ? note : n))));
  }, []);

  async function createNote() {
    setError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/panel/staff-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = (await res.json().catch(() => null)) as {
        note?: SerializedStaffNote;
        error?: string;
      } | null;
      if (!res.ok || !j?.note) {
        setError(j?.error || "Not oluşturulamadı");
        return;
      }
      setNotes((prev) => sortNotes([j.note!, ...prev]));
      setActiveId(j.note.id);
      setQuery("");
    } finally {
      setCreating(false);
    }
  }

  async function removeNote(id: string) {
    if (!confirm("Bu not ve görselleri silinsin mi?")) return;
    setError(null);
    const res = await fetch(`/api/panel/staff-notes/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(j?.error || "Silinemedi");
      return;
    }
    setNotes((prev) => {
      const next = prev.filter((n) => n.id !== id);
      setActiveId((cur) => (cur === id ? (next[0]?.id ?? null) : cur));
      return next;
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      {/* —— Liste —— */}
      <aside className="flex min-h-0 flex-col rounded-xl border border-zinc-200 bg-white shadow-sm lg:max-h-[calc(100vh-180px)]">
        <div className="space-y-3 border-b border-zinc-100 p-3">
          <button
            type="button"
            onClick={() => void createNote()}
            disabled={creating}
            className={`${btnPrimary} w-full`}
          >
            <Plus className="size-4" aria-hidden />
            {creating ? "Açılıyor…" : "Yeni not"}
          </button>
          <label className="relative block">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Notlarda ara…"
              aria-label="Notlarda ara"
              className={`${fieldClass} w-full pl-9`}
            />
          </label>
        </div>

        {visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-zinc-500">
            {notes.length === 0 ? "Henüz not yok." : "Eşleşen not yok."}
          </p>
        ) : (
          <ul className="min-h-0 flex-1 divide-y divide-zinc-100 overflow-y-auto">
            {visible.map((n) => {
              const on = n.id === activeId;
              const snippet = n.body.replace(/\s+/g, " ").trim();
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(n.id)}
                    aria-current={on ? "true" : undefined}
                    className={[
                      "flex w-full gap-3 px-3 py-3 text-left transition",
                      on ? "bg-zinc-100" : "hover:bg-zinc-50",
                    ].join(" ")}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {n.pinned ? (
                          <Pin className="size-3.5 shrink-0 text-[#e91825]" aria-label="Sabitlenmiş" />
                        ) : null}
                        {n.private ? (
                          <Lock className="size-3.5 shrink-0 text-zinc-400" aria-label="Yalnızca ben" />
                        ) : null}
                        <span className="truncate text-sm font-medium text-zinc-900">
                          {n.title || "Başlıksız not"}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">
                        {snippet || (n.images.length ? `${n.images.length} görsel` : "Boş not")}
                      </p>
                      <p className="mt-1 text-[11px] text-zinc-400">
                        {authorLabel(n)} · {fmt.format(new Date(n.updatedAt))}
                      </p>
                    </div>
                    {n.images[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={n.images[0]}
                        alt=""
                        className="size-12 shrink-0 rounded-md border border-zinc-200 object-cover"
                      />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {error ? <p className="border-t border-zinc-100 px-3 py-2 text-xs text-rose-600">{error}</p> : null}
      </aside>

      {/* —— Editör —— */}
      {active ? (
        <NoteEditor
          key={active.id}
          note={active}
          isAuthor={currentUserId !== null && active.authorId === currentUserId}
          onSaved={upsert}
          onDelete={() => void removeNote(active.id)}
        />
      ) : (
        <section className="flex min-h-[360px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-[#e91825]/10 text-[#e91825]">
            <NotebookPen className="size-6" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-semibold text-zinc-900">Notlar</h2>
            <p className="mt-1 max-w-sm text-sm text-zinc-500">
              Genel notlar, referans görseller ve linkler — ihtiyaç duyduğunda buradan al.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void createNote()}
            disabled={creating}
            className={btnPrimary}
          >
            <Plus className="size-4" aria-hidden />
            Yeni not
          </button>
        </section>
      )}
    </div>
  );
}

function NoteEditor({
  note,
  isAuthor,
  onSaved,
  onDelete,
}: {
  note: SerializedStaffNote;
  isAuthor: boolean;
  onSaved: (n: SerializedStaffNote) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [preview, setPreview] = useState(() => note.body.trim().length > 0);
  const [save, setSave] = useState<SaveState>("idle");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Kaydedilmemiş son değerler — debounce ve sekme kapanırken flush için.
  const pending = useRef<{ title?: string; body?: string }>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const patch = useCallback(
    async (data: Record<string, unknown>): Promise<boolean> => {
      setError(null);
      const res = await fetch(`/api/panel/staff-notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        keepalive: true,
      });
      const j = (await res.json().catch(() => null)) as {
        note?: SerializedStaffNote;
        error?: string;
      } | null;
      if (!res.ok || !j?.note) {
        setError(j?.error || "Kaydedilemedi");
        return false;
      }
      onSaved(j.note);
      return true;
    },
    [note.id, onSaved],
  );

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const data = pending.current;
    if (Object.keys(data).length === 0) return;
    pending.current = {};
    setSave("saving");
    const ok = await patch(data);
    setSave(ok ? "saved" : "error");
  }, [patch]);

  const queue = (data: { title?: string; body?: string }) => {
    pending.current = { ...pending.current, ...data };
    setSave("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  };

  // Başka nota geçince / sayfadan çıkınca bekleyen değişiklik kaybolmasın.
  useEffect(() => {
    const onUnload = () => void flush();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      void flush();
    };
  }, [flush]);

  async function addImages(files: File[]) {
    const imgs = files.filter((f) => !f.type || IMAGE_TYPES.has(f.type));
    if (imgs.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of imgs) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`/api/panel/staff-notes/${note.id}/images`, {
          method: "POST",
          body: fd,
        });
        const j = (await res.json().catch(() => null)) as {
          note?: SerializedStaffNote;
          error?: string;
        } | null;
        if (!res.ok || !j?.note) {
          setError(j?.error || "Görsel yüklenemedi");
          break;
        }
        onSaved(j.note);
      }
    } finally {
      setUploading(false);
    }
  }

  async function removeImage(url: string) {
    if (!confirm("Görsel kaldırılsın mı?")) return;
    setError(null);
    const res = await fetch(
      `/api/panel/staff-notes/${note.id}/images?url=${encodeURIComponent(url)}`,
      { method: "DELETE" },
    );
    const j = (await res.json().catch(() => null)) as {
      note?: SerializedStaffNote;
      error?: string;
    } | null;
    if (!res.ok || !j?.note) {
      setError(j?.error || "Görsel kaldırılamadı");
      return;
    }
    onSaved(j.note);
  }

  async function copyBody() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Panoya kopyalanamadı");
    }
  }

  const saveLabel =
    save === "saving"
      ? "Kaydediliyor…"
      : save === "dirty"
        ? "Değişiklik var…"
        : save === "saved"
          ? "Kaydedildi"
          : save === "error"
            ? "Kaydedilemedi"
            : `Son güncelleme ${fmt.format(new Date(note.updatedAt))}`;

  return (
    <section
      className="flex min-w-0 flex-col rounded-xl border border-zinc-200 bg-white shadow-sm"
      onPaste={(e) => {
        // Metin yapıştırmayı bozma; yalnızca görsel varsa yükle.
        if (e.clipboardData.getData("text/plain").trim()) return;
        const files = Array.from(e.clipboardData.files);
        if (files.length === 0) return;
        e.preventDefault();
        void addImages(files);
      }}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-2.5">
        <span
          className={`text-xs ${save === "error" ? "text-rose-600" : "text-zinc-400"}`}
          aria-live="polite"
        >
          {saveLabel}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <IconButton
            label={note.pinned ? "Sabitlemeyi kaldır" : "Sabitle"}
            onClick={() => void patch({ pinned: !note.pinned })}
            active={note.pinned}
          >
            {note.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          </IconButton>
          {isAuthor ? (
            <IconButton
              label={note.private ? "Ekiple paylaş" : "Yalnızca ben göreyim"}
              onClick={() => void patch({ private: !note.private })}
              active={note.private}
            >
              {note.private ? <Lock className="size-4" /> : <Unlock className="size-4" />}
            </IconButton>
          ) : null}
          <IconButton label={copied ? "Kopyalandı" : "Metni kopyala"} onClick={() => void copyBody()}>
            {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
          </IconButton>
          <IconButton label="Notu sil" onClick={onDelete} danger>
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      </header>

      <div className="space-y-4 p-4 sm:p-5">
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            queue({ title: e.target.value });
          }}
          onBlur={() => void flush()}
          maxLength={STAFF_NOTE_TITLE_MAX}
          placeholder="Başlık"
          aria-label="Not başlığı"
          autoFocus={!note.title && !note.body}
          className="w-full border-0 bg-transparent p-0 text-xl font-semibold text-zinc-900 placeholder:text-zinc-300 focus:outline-none focus:ring-0"
        />

        <div className="rounded-lg border border-zinc-200 bg-zinc-50/50">
          <div className="flex items-center justify-between px-3 pt-2">
            <span className="text-xs font-medium text-zinc-500">Not</span>
            {body.trim() ? (
              <button
                type="button"
                onClick={() => setPreview((p) => !p)}
                className="text-xs font-medium text-zinc-600 hover:text-zinc-900"
              >
                {preview ? "Düzenle" : "Önizle"}
              </button>
            ) : null}
          </div>
          {preview && body.trim() ? (
            <div
              className="cursor-text whitespace-pre-wrap break-words px-3 pb-3 pt-1.5 text-sm leading-relaxed text-zinc-800"
              onDoubleClick={() => setPreview(false)}
              title="Düzenlemek için çift tıklayın"
            >
              <RichText text={body} />
            </div>
          ) : (
            <textarea
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                queue({ body: e.target.value });
              }}
              onBlur={() => void flush()}
              rows={12}
              maxLength={STAFF_NOTE_BODY_MAX}
              autoFocus={Boolean(note.title) && !preview}
              placeholder="Notunu, linkleri, referansları yaz… Görsel için ⌘V ile yapıştır."
              className="block w-full resize-y border-0 bg-transparent px-3 pb-3 pt-1.5 text-sm leading-relaxed text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-0"
            />
          )}
        </div>

        <NoteImages
          images={note.images}
          uploading={uploading}
          onAdd={(f) => void addImages(f)}
          onRemove={(u) => void removeImage(u)}
        />

        <p className="text-[11px] text-zinc-400">
          {note.author ? `${authorLabel(note)} yazdı · ` : ""}
          {fmt.format(new Date(note.createdAt))}
          {note.private ? " · Yalnızca sen görüyorsun" : " · Tüm ekip görebilir"}
        </p>

        {error ? <p className="text-xs text-rose-600">{error}</p> : null}
      </div>
    </section>
  );
}

function IconButton({
  label,
  onClick,
  active = false,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      onClick={onClick}
      className={[
        "inline-flex size-9 items-center justify-center rounded-lg transition",
        danger
          ? "text-zinc-500 hover:bg-rose-50 hover:text-rose-600"
          : active
            ? "bg-zinc-900 text-white hover:bg-zinc-700"
            : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function NoteImages({
  images,
  uploading,
  onAdd,
  onRemove,
}: {
  images: string[];
  uploading: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [clipError, setClipError] = useState<string | null>(null);

  async function pasteFromClipboard() {
    setClipError(null);
    if (!navigator.clipboard?.read) {
      setClipError("Tarayıcı izin vermiyor — ⌘V / Ctrl+V ile yapıştırın.");
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        const ext = type.split("/")[1] || "png";
        files.push(new File([blob], `pano-${Date.now()}-${files.length}.${ext}`, { type }));
      }
      if (files.length === 0) {
        setClipError("Panoda görsel yok.");
        return;
      }
      onAdd(files);
    } catch {
      setClipError("Panoya erişilemedi — ⌘V / Ctrl+V ile yapıştırın.");
    }
  }

  return (
    <div
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onAdd(Array.from(e.dataTransfer.files));
      }}
      className={[
        "rounded-lg border border-dashed p-3",
        dragOver ? "border-[#e91825] bg-rose-50/50" : "border-zinc-200",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-zinc-500">Referans görselleri</span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          <ImagePlus className="size-3.5" aria-hidden />
          {uploading ? "Yükleniyor…" : "Görsel ekle"}
        </button>
        <button
          type="button"
          onClick={() => void pasteFromClipboard()}
          disabled={uploading}
          className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          <ClipboardPaste className="size-3.5" aria-hidden />
          Panodan yapıştır
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          hidden
          onChange={(e) => {
            onAdd(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
      {clipError ? <p className="mt-1.5 text-[11px] text-rose-600">{clipError}</p> : null}
      {images.length > 0 ? (
        <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {images.map((url, i) => (
            <li key={url} className="group relative">
              <a href={url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Referans görseli ${i + 1}`}
                  className="aspect-video w-full rounded border border-zinc-200 object-cover"
                />
              </a>
              <button
                type="button"
                title="Görseli kaldır"
                aria-label="Görseli kaldır"
                onClick={() => onRemove(url)}
                className="absolute right-1 top-1 rounded bg-black/60 p-0.5 text-white opacity-0 transition hover:bg-rose-600 focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Trash2 className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-[11px] text-zinc-400">
          Sürükleyip bırakın, ⌘V ile yapıştırın veya “Görsel ekle”ye tıklayın.
        </p>
      )}
    </div>
  );
}
