"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { toolPrimary } from "@/components/panel/ds/buttons";
import { SocialIcon } from "@/components/panel/ds/social-icons";
import type { MetaPageOption } from "@/lib/social/meta";
import { suggestPages } from "@/lib/social/match";
import type { AccountMatrixRow } from "@/lib/social/overview";

type RowState = "idle" | "busy" | "done" | "error";

/**
 * Meta'da system user'a atanmış sayfaları, henüz bağlı olmayan markalara ad
 * benzerliğiyle önerir. Her satır kendi "Bağla" düğmesiyle tek başına ya da
 * işaretlenip toplu bağlanır; hiçbiri önceden işaretli gelmez.
 */
export default function BulkMetaConnect({
  rows,
  takenPageIds,
  onClose,
  onChanged,
}: {
  /** Başka markaya zaten bağlı sayfalar — öneriye girmez (elle seçilebilir). */
  takenPageIds: string[];
  /** Facebook'u bağlı olmayan markalar (görünürler önce). */
  rows: AccountMatrixRow[];
  onClose: () => void;
  /** Bağlama sonrası tablo yenilensin (ebeveynin yenileme göstergesiyle). */
  onChanged: () => void;
}) {
  // Pencere açıkken bağlanan marka listeden düşmesin, öneriler sıfırlanmasın:
  // liste açılıştaki hâliyle sabitlenir.
  const [list] = useState(rows);
  const [taken0] = useState(takenPageIds);
  const single = list.length === 1;
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pages, setPages] = useState<MetaPageOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [suggested, setSuggested] = useState<Set<string>>(new Set());
  const [state, setState] = useState<
    Record<string, { s: RowState; msg?: string }>
  >({});
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/panel/social/meta/pages");
        const j = (await res.json()) as {
          pages?: MetaPageOption[];
          error?: string;
        };
        if (!res.ok) throw new Error(j.error || "Meta sayfaları alınamadı");
        if (!alive) return;
        const all = (j.pages ?? []).filter((p) => p.canPost);
        const taken = new Set(taken0);
        const s = suggestPages(
          list.map((r) => ({ slug: r.tenantSlug, name: r.tenantName })),
          all.filter((p) => !taken.has(p.pageId)),
        );
        setPages(all);
        setChoice(
          Object.fromEntries([...s].map(([slug, m]) => [slug, m.pageId])),
        );
        setSuggested(new Set(s.keys()));
      } catch (err) {
        if (alive)
          setLoadError(
            err instanceof Error ? err.message : "Meta sayfaları alınamadı",
          );
      }
    })();
    return () => {
      alive = false;
    };
  }, [list, taken0]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !anyBusyRef.current) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Gizli markalar yalnızca bir sayfayla eşleştiyse listelenir (ör. ajansın kendi markası). */
  const shown = useMemo(
    () => list.filter((r) => single || r.visible || suggested.has(r.tenantSlug)),
    [list, single, suggested],
  );

  const pageById = useMemo(
    () => new Map((pages ?? []).map((p) => [p.pageId, p])),
    [pages],
  );

  /** Aynı sayfa iki markaya seçilmişse uyarı için. */
  const dupes = useMemo(() => {
    const seen = new Map<string, number>();
    for (const id of Object.values(choice))
      if (id) seen.set(id, (seen.get(id) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([id]) => id));
  }, [choice]);

  const ready = (r: AccountMatrixRow) =>
    Boolean(choice[r.tenantSlug]) && state[r.tenantSlug]?.s !== "done";
  const selectable = shown.filter(ready);
  const selected = selectable.filter((r) => picked.has(r.tenantSlug));
  const allPicked = selectable.length > 0 && selected.length === selectable.length;
  const doneCount = Object.values(state).filter((v) => v.s === "done").length;
  const errorCount = Object.values(state).filter((v) => v.s === "error").length;
  const anyBusy = running || Object.values(state).some((v) => v.s === "busy");
  const anyBusyRef = useRef(anyBusy);
  useEffect(() => {
    anyBusyRef.current = anyBusy;
  }, [anyBusy]);

  function togglePick(slug: string) {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(slug)) n.delete(slug);
      else n.add(slug);
      return n;
    });
  }

  async function connect(r: AccountMatrixRow): Promise<void> {
    const pageId = choice[r.tenantSlug];
    if (!pageId) return;
    setState((s) => ({ ...s, [r.tenantSlug]: { s: "busy" } }));
      try {
        const res = await fetch(
          `/api/panel/tenants/${r.tenantSlug}/social-accounts`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: "meta", pageId }),
          },
        );
        const j = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(j.error || "Bağlanamadı");
        setState((s) => ({ ...s, [r.tenantSlug]: { s: "done" } }));
        setPicked((s) => {
          const n = new Set(s);
          n.delete(r.tenantSlug);
          return n;
        });
      } catch (err) {
        setState((s) => ({
          ...s,
          [r.tenantSlug]: {
            s: "error",
            msg: err instanceof Error ? err.message : "Bağlanamadı",
          },
        }));
      }
  }

  /** Tek satır: yalnızca bu markayı hemen bağlar. */
  async function connectOne(r: AccountMatrixRow) {
    await connect(r);
    setFinished(true);
    onChanged();
  }

  /** İşaretlilerin hepsi. */
  async function run() {
    setRunning(true);
    for (const r of selected) await connect(r);
    setRunning(false);
    setFinished(true);
    onChanged();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !anyBusy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-meta-title"
        className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white text-zinc-900 shadow-2xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
          <div>
            <h3 id="bulk-meta-title" className="text-base font-semibold">
              {single ? `${list[0]!.tenantName} — Meta hesabı bağla` : "Meta hesaplarını bağla"}
            </h3>
            <p className="mt-0.5 text-sm text-zinc-500">
              {single
                ? "Sayfayı seçip Bağla'ya basın. Instagram, sayfaya bağlıysa birlikte gelir."
                : "Sayfalar marka adına göre önerildi. Satırdaki “Bağla” ile tek tek bağlayın ya da işaretleyip toplu bağlayın."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={anyBusy}
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
          ) : !pages ? (
            <p className="flex items-center justify-center gap-2 px-5 py-14 text-sm text-zinc-500">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Meta sayfaları alınıyor…
            </p>
          ) : shown.length === 0 ? (
            <p className="px-5 py-14 text-center text-sm text-zinc-500">
              Tüm markaların Meta hesabı bağlı.
            </p>
          ) : (
            <>
            {!single ? (
              <label className="flex cursor-pointer items-center gap-3 border-b border-zinc-100 bg-zinc-50/70 px-5 py-2.5 text-xs font-medium text-zinc-600">
                <input
                  type="checkbox"
                  className="size-4 accent-[#141111]"
                  checked={allPicked}
                  disabled={anyBusy || selectable.length === 0}
                  onChange={() =>
                    setPicked(allPicked ? new Set() : new Set(selectable.map((r) => r.tenantSlug)))
                  }
                />
                Sayfası seçili olanların tümünü işaretle
                <span className="font-normal text-zinc-400">({selectable.length})</span>
              </label>
            ) : null}
            <ul className="divide-y divide-zinc-100">
              {shown.map((r) => {
                const id = choice[r.tenantSlug] ?? "";
                const page = id ? pageById.get(id) : undefined;
                const st = state[r.tenantSlug];
                const locked = anyBusy || st?.s === "done";
                return (
                  <li
                    key={r.tenantId}
                    className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:gap-4"
                  >
                    {!single ? (
                      <input
                        type="checkbox"
                        className="hidden size-4 shrink-0 accent-[#141111] sm:block"
                        aria-label={`${r.tenantName} işaretle`}
                        checked={picked.has(r.tenantSlug)}
                        disabled={locked || !id}
                        onChange={() => togglePick(r.tenantSlug)}
                      />
                    ) : null}
                    <div className="min-w-0 sm:w-52 sm:shrink-0">
                      <p className="truncate text-sm font-medium">
                        {r.tenantName}
                      </p>
                      {!r.visible ? (
                        <p className="text-xs text-zinc-400">gizli marka</p>
                      ) : null}
                    </div>

                    <div className="min-w-0 flex-1">
                      <label className="relative block">
                        <span className="sr-only">
                          {r.tenantName} için sayfa
                        </span>
                        <select
                          value={id}
                          disabled={locked}
                          onChange={(e) =>
                            setChoice((c) => ({
                              ...c,
                              [r.tenantSlug]: e.target.value,
                            }))
                          }
                          className={`h-9 w-full cursor-pointer appearance-none truncate rounded-full pl-3.5 pr-8 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-zinc-300 disabled:cursor-default ${
                            id
                              ? "bg-zinc-100 text-zinc-900"
                              : "bg-zinc-50 text-zinc-400"
                          }`}
                        >
                          <option value="">Bağlama</option>
                          {pages.map((p) => (
                            <option key={p.pageId} value={p.pageId}>
                              {p.pageName}
                              {p.instagram?.username
                                ? ` · @${p.instagram.username}`
                                : ""}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
                          aria-hidden
                        />
                      </label>
                      {page ? (
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-3.5 text-xs text-zinc-500">
                          <span className="inline-flex items-center gap-1">
                            <SocialIcon
                              platform="facebook"
                              brand
                              className="size-3"
                            />
                            {page.pageName}
                          </span>
                          {page.instagram ? (
                            <span className="inline-flex items-center gap-1">
                              <SocialIcon
                                platform="instagram"
                                brand
                                className="size-3"
                              />
                              @{page.instagram.username ?? page.instagram.id}
                            </span>
                          ) : (
                            <span className="text-amber-700">
                              Instagram bağlı değil
                            </span>
                          )}
                          {dupes.has(page.pageId) ? (
                            <span className="text-amber-700">
                              Bu sayfa başka markaya da seçili
                            </span>
                          ) : null}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex h-8 shrink-0 items-center gap-2 sm:w-28 sm:justify-end">
                      {st?.s === "busy" ? (
                        <Loader2
                          className="size-4 animate-spin text-zinc-400"
                          aria-label="Bağlanıyor"
                        />
                      ) : st?.s === "done" ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                          <Check className="size-3.5" aria-hidden />
                          Bağlandı
                        </span>
                      ) : st?.s === "error" ? (
                        <span
                          className="inline-flex items-center gap-1 text-xs font-medium text-rose-700"
                          title={st.msg}
                        >
                          <AlertTriangle className="size-3.5" aria-hidden />
                          Hata
                        </span>
                      ) : null}
                      {st?.s !== "busy" && st?.s !== "done" ? (
                        <button
                          type="button"
                          onClick={() => void connectOne(r)}
                          disabled={!id || anyBusy}
                          title={id && suggested.has(r.tenantSlug) ? "Önerilen sayfayı bağla" : undefined}
                          className="inline-flex h-8 items-center gap-1 rounded-full bg-[#141111] px-3 text-xs font-medium text-white transition hover:bg-[#e91825] disabled:bg-zinc-200 disabled:text-zinc-400"
                        >
                          {id && suggested.has(r.tenantSlug) ? <Sparkles className="size-3" aria-hidden /> : null}
                          Bağla
                        </button>
                      ) : null}
                    </div>
                    {st?.s === "error" && st.msg ? (
                      <p className="text-xs text-rose-700 sm:hidden">
                        {st.msg}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-zinc-100 px-5 py-3">
          <p className="text-xs text-zinc-500">
            {finished
              ? `${doneCount} marka bağlandı${errorCount ? `, ${errorCount} hata` : ""}.`
              : single
                ? ""
                : selected.length
                  ? `${selected.length} marka işaretli.`
                  : "Satırdaki “Bağla” ile tek tek bağlayabilirsiniz."}
          </p>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={anyBusy}
              className="inline-flex h-9 items-center rounded-full px-4 text-sm text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40"
            >
              {finished ? "Kapat" : "İptal"}
            </button>
            {selected.length > 0 ? (
              <button
                type="button"
                onClick={() => void run()}
                disabled={anyBusy || !pages}
                className={`${toolPrimary} !h-9 !px-4 !text-sm`}
              >
                {running ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : null}
                {running ? "Bağlanıyor…" : `İşaretli ${selected.length} markayı bağla`}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
