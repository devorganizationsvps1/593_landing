"use client";

import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AlertTriangle, HelpCircle } from "lucide-react";

/**
 * Tarayıcının `confirm()` penceresi yerine panelin kendi onay penceresi.
 *
 *   if (!(await confirmDialog("İçerik silinsin mi?"))) return;
 *
 * Metindeki ilk boş satıra kadarki kısım başlık, kalanı açıklama olur. Silme /
 * kaldırma gibi geri dönüşü zor işlemler kendiliğinden kırmızı gösterilir.
 */
export type ConfirmOptions = {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};

type Pending = ConfirmOptions & { id: number; resolve: (ok: boolean) => void };

const DANGER = /\b(silin|sil\b|kaldırıl|temizlen|kalıcı|geri alınamaz)/i;

let root: Root | null = null;
let push: ((p: Pending) => void) | null = null;
const queue: Pending[] = [];
let seq = 0;

export function confirmDialog(input: string | ConfirmOptions): Promise<boolean> {
  const opts = typeof input === "string" ? { message: input } : input;
  if (typeof document === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const p = { ...opts, id: ++seq, resolve };
    if (push) push(p);
    else queue.push(p);
    if (!root) {
      const el = document.createElement("div");
      el.setAttribute("data-confirm-host", "");
      document.body.appendChild(el);
      root = createRoot(el);
      root.render(<ConfirmHost />);
    }
  });
}

function ConfirmHost() {
  const [items, setItems] = useState<Pending[]>(() => queue.splice(0));
  useEffect(() => {
    const add = (p: Pending) => setItems((list) => [...list, p]);
    push = add;
    // İlk çizimle effect arasında gelenler.
    queue.splice(0).forEach(add);
    return () => {
      push = null;
    };
  }, []);
  const current = items[0];
  if (!current) return null;
  return (
    <ConfirmModal
      key={current.id}
      item={current}
      onDone={(ok) => {
        current.resolve(ok);
        setItems((list) => list.slice(1));
      }}
    />
  );
}

function splitMessage(item: ConfirmOptions): { title: string; body: string | null } {
  if (item.title) return { title: item.title, body: item.message };
  const [head, ...rest] = item.message.split(/\n\s*\n/);
  return { title: head.trim(), body: rest.join("\n\n").trim() || null };
}

function ConfirmModal({ item, onDone }: { item: Pending; onDone: (ok: boolean) => void }) {
  const okRef = useRef<HTMLButtonElement>(null);
  const danger = item.tone ? item.tone === "danger" : DANGER.test(item.message);
  const { title, body } = splitMessage(item);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onDone(false);
      }
    };
    // Yakalama evresinde: altta açık pencerenin Escape'i tetiklenmesin.
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [onDone]);

  const Icon = danger ? AlertTriangle : HelpCircle;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDone(false);
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={body ? "confirm-body" : undefined}
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl"
      >
        <div className="flex gap-3.5">
          <span
            className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
              danger ? "bg-rose-50 text-rose-600" : "bg-zinc-100 text-zinc-700"
            }`}
            aria-hidden
          >
            <Icon className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1 pt-1">
            <h2 id="confirm-title" className="whitespace-pre-line break-words text-[15px] font-semibold text-zinc-900">
              {title}
            </h2>
            {body ? (
              <p id="confirm-body" className="mt-1.5 whitespace-pre-line break-words text-sm leading-relaxed text-zinc-600">
                {body}
              </p>
            ) : null}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onDone(false)}
            className="inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"
          >
            {item.cancelLabel ?? "Vazgeç"}
          </button>
          <button
            ref={okRef}
            type="button"
            onClick={() => onDone(true)}
            className={`inline-flex h-9 items-center rounded-full px-4 text-sm font-semibold text-white transition focus-visible:outline-2 focus-visible:outline-offset-2 ${
              danger
                ? "bg-rose-600 hover:bg-rose-700 focus-visible:outline-rose-600"
                : "bg-[#141111] hover:bg-[#e91825] focus-visible:outline-[#e91825]"
            }`}
          >
            {item.confirmLabel ?? (danger ? "Evet, devam et" : "Onayla")}
          </button>
        </div>
      </div>
    </div>
  );
}
