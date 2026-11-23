"use client";

import type { KeyboardEvent, MouseEvent, RefObject } from "react";
import { Bold, Eraser } from "lucide-react";
import { TEXT_COLORS, stripFormatting, type TextColorKey } from "@/components/panel/RichText";

type Target = {
  ref: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
};

const COLOR_OPEN = new RegExp(`\\{(${TEXT_COLORS.map((c) => c.key).join("|")})\\}$`);

/** Değeri günceller, ardından seçimi yeni konuma taşır. */
function commit(t: Target, next: string, selStart: number, selEnd: number) {
  t.onChange(next);
  requestAnimationFrame(() => {
    const el = t.ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(selStart, selEnd);
  });
}

function selection(t: Target) {
  const el = t.ref.current;
  const start = el?.selectionStart ?? t.value.length;
  const end = el?.selectionEnd ?? t.value.length;
  return { start, end, before: t.value.slice(0, start), sel: t.value.slice(start, end), after: t.value.slice(end) };
}

/** Seçimi `**` ile sarar; zaten sarılıysa kaldırır. */
export function toggleBold(t: Target) {
  const { start, end, before, sel, after } = selection(t);
  if (before.endsWith("**") && after.startsWith("**")) {
    commit(t, before.slice(0, -2) + sel + after.slice(2), start - 2, end - 2);
    return;
  }
  if (sel.length >= 4 && sel.startsWith("**") && sel.endsWith("**")) {
    const inner = sel.slice(2, -2);
    commit(t, before + inner + after, start, start + inner.length);
    return;
  }
  commit(t, `${before}**${sel}**${after}`, start + 2, end + 2);
}

/** Seçimin rengini değiştirir; `null` rengi kaldırır. */
export function applyColor(t: Target, key: TextColorKey | null) {
  const { before, sel, after } = selection(t);
  // Seçim içindeki eski renk işaretlerini temizle (kalın korunur).
  const clean = sel.replace(
    new RegExp(`\\{\\/?(${TEXT_COLORS.map((c) => c.key).join("|")})\\}`, "g"),
    "",
  );
  let head = before;
  let tail = after;
  const wrapped = before.match(COLOR_OPEN);
  if (wrapped && after.startsWith(`{/${wrapped[1]}}`)) {
    head = before.slice(0, -wrapped[0].length);
    tail = after.slice(wrapped[1].length + 3);
  }
  const open = key ? `{${key}}` : "";
  const close = key ? `{/${key}}` : "";
  const s = head.length + open.length;
  commit(t, `${head}${open}${clean}${close}${tail}`, s, s + clean.length);
}

/** Seçimdeki tüm biçimi (kalın + renk) kaldırır. */
function clearFormat(t: Target) {
  const { start, before, sel, after } = selection(t);
  const plain = stripFormatting(sel);
  commit(t, before + plain + after, start, start + plain.length);
}

/** Textarea kısayolu: ⌘B / Ctrl+B → kalın. */
export function handleFormatKeyDown(e: KeyboardEvent<HTMLTextAreaElement>, t: Target): boolean {
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
    e.preventDefault();
    toggleBold(t);
    return true;
  }
  return false;
}

/**
 * Not alanları için küçük biçim çubuğu: kalın + yazı rengi.
 * Metin `**kalın**` ve `{red}…{/red}` olarak saklanır, `RichText` gösterir.
 */
export default function FormatToolbar({
  textareaRef,
  value,
  onChange,
  disabled = false,
  className = "",
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const t: Target = { ref: textareaRef, value, onChange };
  // Düğmeye basınca textarea odağı/seçimi kaybolmasın.
  const keep = (e: MouseEvent) => e.preventDefault();
  const btn =
    "inline-flex size-7 items-center justify-center rounded-md text-zinc-600 transition hover:bg-zinc-200/70 hover:text-zinc-900 disabled:opacity-40";

  return (
    <div
      role="toolbar"
      aria-label="Metin biçimi"
      className={`flex flex-wrap items-center gap-0.5 ${className}`}
    >
      <button
        type="button"
        onMouseDown={keep}
        onClick={() => toggleBold(t)}
        disabled={disabled}
        title="Kalın (⌘B)"
        aria-label="Kalın"
        className={btn}
      >
        <Bold className="size-4" aria-hidden strokeWidth={2.5} />
      </button>
      <span className="mx-1 h-4 w-px bg-zinc-200" aria-hidden />
      {TEXT_COLORS.map((c) => (
        <button
          key={c.key}
          type="button"
          onMouseDown={keep}
          onClick={() => applyColor(t, c.key)}
          disabled={disabled}
          title={`${c.label} yazı`}
          aria-label={`${c.label} yazı`}
          className={btn}
        >
          <span
            className="size-3.5 rounded-full ring-1 ring-black/10"
            style={{ backgroundColor: c.swatch }}
            aria-hidden
          />
        </button>
      ))}
      <span className="mx-1 h-4 w-px bg-zinc-200" aria-hidden />
      <button
        type="button"
        onMouseDown={keep}
        onClick={() => clearFormat(t)}
        disabled={disabled}
        title="Biçimi temizle"
        aria-label="Biçimi temizle"
        className={btn}
      >
        <Eraser className="size-4" aria-hidden />
      </button>
    </div>
  );
}
