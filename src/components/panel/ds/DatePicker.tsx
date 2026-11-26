"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";

/**
 * Panelin tarih / tarih-saat seçicisi — tarayıcının `<input type="date">` ve
 * `datetime-local` yerine. Değer biçimleri yerel inputla aynı:
 *   date:     "YYYY-MM-DD"
 *   datetime: "YYYY-MM-DDTHH:mm" (tarayıcı yerel saati)
 * Boş = "". `name` verilirse form gönderimi için gizli input da yazılır.
 */
export type DatePickerProps = {
  mode?: "date" | "datetime";
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  /** Bu günden önceki günler seçilemez ("YYYY-MM-DD" ya da tarih-saat değeri). */
  min?: string;
  placeholder?: string;
  /** Tetikleyici düğmenin sınıfı — sayfadaki alan görünümünü korur. */
  className?: string;
  "aria-label"?: string;
};

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const QUICK_TIMES = ["09:00", "12:00", "15:00", "18:00", "20:00"];

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parse(value: string): { date: string; hh: number; mm: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value);
  if (!m) return null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, hh: m[4] ? Number(m[4]) : 12, mm: m[5] ? Number(m[5]) : 0 };
}

function dateOf(key: string): Date {
  const [y, mo, d] = key.split("-").map(Number);
  return new Date(y!, mo! - 1, d!);
}

const displayFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", weekday: "short" });

function display(value: string, mode: "date" | "datetime"): string {
  const p = parse(value);
  if (!p) return "";
  const base = displayFmt.format(dateOf(p.date));
  return mode === "datetime" ? `${base} · ${pad(p.hh)}:${pad(p.mm)}` : base;
}

export default function DatePicker({
  mode = "date",
  value: controlled,
  defaultValue = "",
  onChange,
  name,
  disabled = false,
  required = false,
  min,
  placeholder,
  className = "",
  "aria-label": ariaLabel,
}: DatePickerProps) {
  const [inner, setInner] = useState(defaultValue);
  const value = controlled ?? inner;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const commit = useCallback(
    (v: string) => {
      if (controlled === undefined) setInner(v);
      onChange?.(v);
    },
    [controlled, onChange],
  );

  const text = display(value, mode);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      >
        <span className={`min-w-0 flex-1 truncate ${text ? "" : "text-zinc-400"}`}>
          {text || placeholder || (mode === "datetime" ? "Tarih ve saat seçin" : "Tarih seçin")}
        </span>
        <CalendarDays className="size-4 shrink-0 text-zinc-400" aria-hidden />
      </button>
      {name ? <input type="hidden" name={name} value={value} required={required} /> : null}
      {open ? (
        <Popover
          anchor={triggerRef}
          mode={mode}
          value={value}
          min={min}
          clearable={!required}
          onPick={(v, close) => {
            commit(v);
            if (close) setOpen(false);
          }}
          onClose={() => {
            setOpen(false);
            triggerRef.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}

function Popover({
  anchor,
  mode,
  value,
  min,
  clearable,
  onPick,
  onClose,
}: {
  anchor: React.RefObject<HTMLButtonElement | null>;
  mode: "date" | "datetime";
  value: string;
  min?: string;
  clearable: boolean;
  onPick: (value: string, close: boolean) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const parsed = parse(value);
  const todayKey = ymd(new Date());
  const minKey = min ? parse(min)?.date : undefined;
  const [view, setView] = useState(() => {
    const d = dateOf(parsed?.date ?? todayKey);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [focusKey, setFocusKey] = useState(parsed?.date ?? todayKey);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Konum: tetikleyicinin altı; sığmazsa üstü. Kaydırma / boyutta güncellenir.
  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const gap = 6;
      let top = a.bottom + gap;
      if (top + h > window.innerHeight - 8 && a.top - gap - h > 8) top = a.top - gap - h;
      const left = Math.max(8, Math.min(a.left, window.innerWidth - w - 8));
      setPos({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Alttaki pencere kapanmasın.
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [anchor, onClose]);

  // Klavyeyle gezinilen gün odakta kalsın.
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>(`[data-day="${focusKey}"]`)?.focus();
  }, [focusKey, view]);

  const days = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const offset = (first.getDay() + 6) % 7; // pazartesi başlar
    return Array.from({ length: 42 }, (_, i) => new Date(view.y, view.m, 1 - offset + i));
  }, [view]);

  const hh = parsed?.hh ?? 12;
  const mm = parsed?.mm ?? 0;
  const build = (date: string, h = hh, m = mm) => (mode === "datetime" ? `${date}T${pad(h)}:${pad(m)}` : date);

  function shiftMonth(delta: number) {
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  }

  function moveFocus(deltaDays: number) {
    const d = dateOf(focusKey);
    d.setDate(d.getDate() + deltaDays);
    setFocusKey(ymd(d));
    if (d.getMonth() !== view.m || d.getFullYear() !== view.y) setView({ y: d.getFullYear(), m: d.getMonth() });
  }

  function pickDay(key: string) {
    if (minKey && key < minKey) return;
    setFocusKey(key);
    onPick(build(key), mode === "date");
  }

  const selectedDate = parsed?.date;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={mode === "datetime" ? "Tarih ve saat seçin" : "Tarih seçin"}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
      className="fixed z-[900] flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_12px_40px_-12px_rgba(20,17,17,0.25)] sm:flex-row"
    >
      {/* takvim */}
      <div className="w-[17.5rem] p-3">
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label="Önceki ay"
            className="inline-flex size-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
          >
            <ChevronLeft className="size-4" />
          </button>
          <p className="text-sm font-semibold text-[#141111]" aria-live="polite">
            {MONTHS[view.m]} {view.y}
          </p>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            aria-label="Sonraki ay"
            className="inline-flex size-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 text-center text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
          {WEEKDAYS.map((w) => (
            <span key={w} className="py-1">
              {w}
            </span>
          ))}
        </div>
        <div
          className="grid grid-cols-7 gap-y-0.5"
          role="grid"
          onKeyDown={(e) => {
            const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
            if (step) {
              e.preventDefault();
              moveFocus(step);
            } else if (e.key === "PageUp" || e.key === "PageDown") {
              e.preventDefault();
              shiftMonth(e.key === "PageUp" ? -1 : 1);
            }
          }}
        >
          {days.map((d) => {
            const key = ymd(d);
            const outside = d.getMonth() !== view.m;
            const selected = key === selectedDate;
            const today = key === todayKey;
            const blocked = Boolean(minKey && key < minKey);
            const weekend = d.getDay() === 0 || d.getDay() === 6;
            return (
              <button
                key={key}
                type="button"
                data-day={key}
                tabIndex={key === focusKey ? 0 : -1}
                disabled={blocked}
                aria-pressed={selected}
                aria-label={displayFmt.format(d)}
                onClick={() => pickDay(key)}
                className={`relative mx-auto flex size-9 items-center justify-center rounded-full text-[13px] tabular-nums transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#e91825] disabled:cursor-not-allowed disabled:text-zinc-300 disabled:hover:bg-transparent ${
                  selected
                    ? "bg-[#141111] font-semibold text-white hover:bg-[#e91825]"
                    : outside
                      ? "text-zinc-300 hover:bg-zinc-100 hover:text-zinc-600"
                      : `${weekend ? "text-zinc-500" : "text-zinc-800"} hover:bg-zinc-100`
                }`}
              >
                {d.getDate()}
                {today && !selected ? (
                  <span className="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-[#e91825]" aria-hidden />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex items-center justify-between border-t border-zinc-100 pt-2">
          <button
            type="button"
            onClick={() => {
              const d = new Date();
              setView({ y: d.getFullYear(), m: d.getMonth() });
              if (!minKey || todayKey >= minKey) pickDay(todayKey);
            }}
            className="rounded-full px-2.5 py-1 text-xs font-semibold text-[#e91825] transition hover:bg-rose-50"
          >
            Bugün
          </button>
          {clearable && value ? (
            <button
              type="button"
              onClick={() => onPick("", true)}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800"
            >
              <X className="size-3" aria-hidden />
              Temizle
            </button>
          ) : null}
        </div>
      </div>

      {/* saat */}
      {mode === "datetime" ? (
        <TimePanel
          hh={hh}
          mm={mm}
          disabled={!selectedDate}
          onTime={(h, m) => selectedDate && onPick(build(selectedDate, h, m), false)}
          onDone={onClose}
        />
      ) : null}
    </div>,
    document.body,
  );
}

function TimePanel({
  hh,
  mm,
  disabled,
  onTime,
  onDone,
}: {
  hh: number;
  mm: number;
  disabled: boolean;
  onTime: (h: number, m: number) => void;
  onDone: () => void;
}) {
  const minutes = useMemo(() => {
    const base = Array.from({ length: 12 }, (_, i) => i * 5);
    return base.includes(mm) ? base : [...base, mm].sort((a, b) => a - b);
  }, [mm]);
  const hourCol = useRef<HTMLDivElement>(null);
  const minCol = useRef<HTMLDivElement>(null);

  // Seçili saat / dakika görünür alanın ortasında başlasın.
  useEffect(() => {
    for (const col of [hourCol.current, minCol.current]) {
      const sel = col?.querySelector<HTMLElement>("[aria-pressed=true]");
      if (col && sel) col.scrollTop = sel.offsetTop - col.clientHeight / 2 + sel.offsetHeight / 2;
    }
  }, [hh, mm]);

  const cell = (on: boolean) =>
    `block w-full rounded-lg py-1.5 text-center text-[13px] tabular-nums transition ${
      on ? "bg-[#141111] font-semibold text-white" : "text-zinc-700 hover:bg-zinc-100"
    }`;

  return (
    <div className="flex w-full flex-col border-t border-zinc-100 bg-zinc-50/60 p-3 sm:w-44 sm:border-l sm:border-t-0">
      <p className="mb-2 flex items-baseline justify-between text-xs font-semibold text-zinc-500">
        Saat
        <span className="text-base font-semibold tabular-nums text-[#141111]">
          {pad(hh)}:{pad(mm)}
        </span>
      </p>
      {disabled ? (
        <p className="flex-1 text-xs leading-relaxed text-zinc-400">Önce bir gün seçin.</p>
      ) : (
        <>
          <div className="mb-2 grid grid-cols-3 gap-1">
            {QUICK_TIMES.map((t) => {
              const [h, m] = t.split(":").map(Number);
              const on = h === hh && m === mm;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => onTime(h!, m!)}
                  className={`rounded-full py-0.5 text-center text-[11px] font-medium tabular-nums transition ${
                    on ? "bg-[#141111] text-white" : "bg-white text-zinc-600 ring-1 ring-zinc-200 hover:ring-zinc-400"
                  }`}
                >
                  {t}
                </button>
              );
            })}
          </div>
          <div className="grid h-44 flex-1 grid-cols-2 gap-1 sm:h-auto sm:max-h-52">
            <div ref={hourCol} className="relative overflow-y-auto pr-0.5" aria-label="Saat">
              {HOURS.map((h) => (
                <button key={h} type="button" aria-pressed={h === hh} onClick={() => onTime(h, mm)} className={cell(h === hh)}>
                  {pad(h)}
                </button>
              ))}
            </div>
            <div ref={minCol} className="relative overflow-y-auto pr-0.5" aria-label="Dakika">
              {minutes.map((m) => (
                <button key={m} type="button" aria-pressed={m === mm} onClick={() => onTime(hh, m)} className={cell(m === mm)}>
                  {pad(m)}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      <button
        type="button"
        onClick={onDone}
        className="mt-2 inline-flex h-8 items-center justify-center rounded-full bg-[#141111] text-xs font-semibold text-white transition hover:bg-[#e91825]"
      >
        Tamam
      </button>
    </div>
  );
}
