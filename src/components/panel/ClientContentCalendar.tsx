"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import type { ContentPostStatus } from "@prisma/client";
import type { ClientCalendarPost } from "@/lib/panel/client-calendar";

/* Marka panelindeki salt okunur paylaşım takvimi. */

const WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const TR_MONTHS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];
const WEEKDAYS_LONG = [
  "Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi",
];

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  x: "X",
  youtube: "YouTube",
};

/** Müşteriye gösterilen durum adları (ajans içi "Taslak / Tasarımda" yerine). */
const STATUS: Record<ContentPostStatus, { label: string; dot: string; chip: string; badge: string }> = {
  draft: {
    label: "Planlandı",
    dot: "bg-zinc-400",
    chip: "border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100",
    badge: "bg-zinc-100 text-zinc-700",
  },
  design: {
    label: "Hazırlanıyor",
    dot: "bg-amber-500",
    chip: "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100",
    badge: "bg-amber-100 text-amber-800",
  },
  review: {
    label: "Onayda",
    dot: "bg-sky-500",
    chip: "border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100",
    badge: "bg-sky-100 text-sky-800",
  },
  approved: {
    label: "Onaylandı",
    dot: "bg-violet-500",
    chip: "border-violet-200 bg-violet-50 text-violet-900 hover:bg-violet-100",
    badge: "bg-violet-100 text-violet-800",
  },
  published: {
    label: "Paylaşıldı",
    dot: "bg-emerald-500",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100",
    badge: "bg-emerald-100 text-emerald-800",
  },
};
const STATUS_ORDER: ContentPostStatus[] = ["draft", "design", "review", "approved", "published"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** Pazartesi başlangıçlı ay ızgarası — gün anahtarları (YYYY-AA-GG), saat diliminden bağımsız. */
function monthGrid(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y!, m! - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => {
    const d = new Date(Date.UTC(y!, m! - 1, 1 - lead + i));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  });
}

function longDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const wd = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return `${d} ${TR_MONTHS[m! - 1]} ${WEEKDAYS_LONG[wd]}`;
}

function postTitle(p: ClientCalendarPost): string {
  return p.title.trim() || `${PLATFORM_LABEL[p.platform] ?? p.platform} paylaşımı`;
}

export default function ClientContentCalendar({
  month,
  today,
  posts,
}: {
  /** YYYY-AA */
  month: string;
  /** Bugün (İstanbul) — YYYY-AA-GG */
  today: string;
  posts: ClientCalendarPost[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const days = useMemo(() => monthGrid(month), [month]);
  const byDay = useMemo(() => {
    const map = new Map<string, ClientCalendarPost[]>();
    for (const p of posts) {
      const list = map.get(p.day);
      if (list) list.push(p);
      else map.set(p.day, [p]);
    }
    return map;
  }, [posts]);
  const inMonth = useMemo(() => posts.filter((p) => p.day.startsWith(month)), [posts, month]);
  const agendaDays = useMemo(() => [...new Set(inMonth.map((p) => p.day))], [inMonth]);
  const open = openId ? (posts.find((p) => p.id === openId) ?? null) : null;

  const [y, m] = month.split("-").map(Number);
  const title = `${TR_MONTHS[m! - 1]} ${y}`;
  const publishedCount = inMonth.filter((p) => p.status === "published").length;
  const isCurrentMonth = today.startsWith(month);
  const navBtn =
    "inline-flex size-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-900";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Paylaşım takvimi</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {inMonth.length === 0
              ? "Sosyal medya paylaşım planınız"
              : `${title} · ${inMonth.length} paylaşım, ${publishedCount} tanesi paylaşıldı`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isCurrentMonth ? (
            <Link
              href="/takvim"
              className="inline-flex h-9 items-center rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
            >
              Bugün
            </Link>
          ) : null}
          <Link href={`/takvim?month=${shiftMonth(month, -1)}`} className={navBtn} aria-label="Önceki ay">
            <ChevronLeft className="size-4" aria-hidden />
          </Link>
          <span className="min-w-[8.5rem] text-center text-sm font-semibold tabular-nums text-zinc-900">
            {title}
          </span>
          <Link href={`/takvim?month=${shiftMonth(month, 1)}`} className={navBtn} aria-label="Sonraki ay">
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
        {STATUS_ORDER.map((s) => (
          <li key={s} className="inline-flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${STATUS[s].dot}`} aria-hidden />
            {STATUS[s].label}
          </li>
        ))}
      </ul>

      {/* Masaüstü: ay ızgarası */}
      <div className="hidden overflow-hidden rounded-xl border border-zinc-200 bg-white md:block">
        <div className="grid grid-cols-7 border-b border-zinc-200 text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((k, i) => {
            const inThisMonth = k.startsWith(month);
            const items = byDay.get(k) ?? [];
            const dayNum = Number(k.slice(8));
            return (
              <div
                key={k}
                className={[
                  "min-h-28 min-w-0 border-b border-r border-zinc-100 px-1.5 pb-1.5",
                  i % 7 === 6 ? "border-r-0" : "",
                  i >= days.length - 7 ? "border-b-0" : "",
                  inThisMonth ? "bg-white" : "bg-zinc-50/70",
                ].join(" ")}
              >
                <div className="flex h-8 items-center justify-center">
                  <span
                    className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs ${
                      k === today
                        ? "bg-[#e91825] font-bold text-white"
                        : inThisMonth
                          ? "font-medium text-zinc-700"
                          : "text-zinc-400"
                    }`}
                  >
                    {dayNum}
                  </span>
                </div>
                <ul className="space-y-1">
                  {items.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setOpenId(p.id)}
                        title={`${p.time} · ${postTitle(p)} · ${STATUS[p.status].label}`}
                        className={`flex w-full min-w-0 items-center gap-1.5 rounded-md border px-1.5 py-1 text-left text-[11px] leading-4 transition ${STATUS[p.status].chip} ${inThisMonth ? "" : "opacity-60"}`}
                      >
                        <span className={`size-1.5 shrink-0 rounded-full ${STATUS[p.status].dot}`} aria-hidden />
                        <span className="shrink-0 tabular-nums opacity-70">{p.time}</span>
                        <span className="truncate font-medium">{postTitle(p)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobil: gün gün liste */}
      <div className="space-y-4 md:hidden">
        {agendaDays.map((k) => (
          <section key={k}>
            <h3 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${k === today ? "text-[#e91825]" : "text-zinc-500"}`}>
              {longDay(k)}
              {k === today ? " · Bugün" : ""}
            </h3>
            <ul className="space-y-2">
              {(byDay.get(k) ?? []).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(p.id)}
                    className="flex w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-3 text-left transition hover:bg-zinc-50"
                  >
                    <span className="w-11 shrink-0 text-sm font-semibold tabular-nums text-zinc-900">{p.time}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-zinc-900">{postTitle(p)}</span>
                      <span className="mt-0.5 block text-xs text-zinc-500">
                        {PLATFORM_LABEL[p.platform] ?? p.platform}
                      </span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[p.status].badge}`}>
                      {STATUS[p.status].label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {inMonth.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-10 text-center">
          <CalendarDays className="size-6 text-zinc-400" aria-hidden />
          <p className="text-sm font-medium text-zinc-800">{title} için planlanmış paylaşım yok</p>
          <p className="text-sm text-zinc-500">Diğer aylara bakmak için yukarıdaki okları kullanın.</p>
        </div>
      ) : null}

      {open ? <PostDialog post={open} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

function PostDialog({ post, onClose }: { post: ClientCalendarPost; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const st = STATUS[post.status];
  const hasMedia = post.media.length > 0 || post.mediaUrls.length > 0;

  return (
    <div className="fixed inset-0 m-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="presentation">
      <button type="button" aria-label="Kapat" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={postTitle(post)}
        className="relative flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-w-xl sm:rounded-2xl"
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-zinc-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-zinc-900">{postTitle(post)}</h3>
            <p className="mt-1 text-sm text-zinc-500">
              {longDay(post.day)} · {post.time} · {PLATFORM_LABEL[post.platform] ?? post.platform}
            </p>
          </div>
          <span className={`mt-0.5 shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${st.badge}`}>
            {st.label}
          </span>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="-mr-2 -mt-1 shrink-0 rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Kapat"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {hasMedia ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {post.media.map((m) =>
                m.kind === "video" ? (
                  <video
                    key={m.id}
                    src={m.url}
                    controls
                    preload="metadata"
                    className="aspect-square w-full rounded-lg border border-zinc-200 bg-black object-contain"
                  />
                ) : (
                  <a
                    key={m.id}
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block aspect-square overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  </a>
                ),
              )}
              {post.mediaUrls.map((u) =>
                /\.(png|jpe?g|webp|gif)(\?|$)/i.test(u) ? (
                  <a
                    key={u}
                    href={u}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block aspect-square overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt="" className="h-full w-full object-cover" loading="lazy" />
                  </a>
                ) : (
                  <a
                    key={u}
                    href={u}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2 text-center text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                  >
                    <ExternalLink className="size-4 text-zinc-400" aria-hidden />
                    Görseli aç
                  </a>
                ),
              )}
            </div>
          ) : null}

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Paylaşım metni</p>
            {post.caption.trim() ? (
              <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-800">
                {post.caption}
              </p>
            ) : (
              <p className="mt-1.5 text-sm text-zinc-500">Metin henüz eklenmedi.</p>
            )}
          </div>

          {post.links.length > 0 ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Yayındaki paylaşım</p>
              <ul className="mt-1.5 flex flex-wrap gap-2">
                {post.links.map((l) => (
                  <li key={l.platform}>
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                    >
                      {PLATFORM_LABEL[l.platform] ?? l.platform}
                      <ExternalLink className="size-3.5 text-zinc-400" aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
