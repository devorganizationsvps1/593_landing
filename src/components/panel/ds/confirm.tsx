"use client";

import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AlertTriangle, CheckCircle2, HelpCircle, Info } from "lucide-react";

/**
 * Tarayıcının `confirm()` / `prompt()` pencereleri yerine panelin kendi penceresi.
 *
 *   if (!(await confirmDialog("İçerik silinsin mi?"))) return;
 *   const phone = await promptDialog({ message: "Telefon", defaultValue: "+90" }); // null = vazgeçti
 *   await alertDialog({ message: "Paylaşım silindi.", tone: "success" }); // tek "Tamam" düğmesi
 *
 * Metindeki ilk boş satıra kadarki kısım başlık, kalanı açıklama olur. Silme /
 * kaldırma gibi geri dönüşü zor işlemler kendiliğinden kırmızı gösterilir.
 */
export type ConfirmOptions = {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger" | "success";
};

export type PromptOptions = ConfirmOptions & {
  defaultValue?: string;
  placeholder?: string;
  inputType?: "text" | "tel" | "email";
  /** Verilirse onay düğmesi yalnızca bu metin aynen yazılınca açılır (ör. "SİL"). */
  mustEqual?: string;
};

type Pending = PromptOptions & {
  id: number;
  prompt: boolean;
  /** Bilgilendirme: yalnızca "Tamam" düğmesi. */
  alert?: boolean;
  /** Onayda girilen metin (onay penceresinde ""), vazgeçince null. */
  resolve: (value: string | null) => void;
};

const DANGER = /\b(silin|sil\b|kaldırıl|temizlen|kalıcı|geri alınamaz)/i;

let root: Root | null = null;
let push: ((p: Pending) => void) | null = null;
const queue: Pending[] = [];
let seq = 0;

export function confirmDialog(input: string | ConfirmOptions): Promise<boolean> {
  const opts = typeof input === "string" ? { message: input } : input;
  return open(opts, false).then((v) => v !== null);
}

/** `prompt()` karşılığı: girilen metni, vazgeçilirse null döner. */
export function promptDialog(input: string | PromptOptions): Promise<string | null> {
  const opts = typeof input === "string" ? { message: input } : input;
  return open(opts, true);
}

/** `alert()` karşılığı: bilgilendirme penceresi, kapatılınca çözülür. */
export function alertDialog(input: string | ConfirmOptions): Promise<void> {
  const opts = typeof input === "string" ? { message: input } : input;
  return open(opts, false, true).then(() => undefined);
}

function open(opts: PromptOptions, prompt: boolean, alert = false): Promise<string | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const p: Pending = { ...opts, id: ++seq, prompt, alert, resolve };
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
      onDone={(value) => {
        current.resolve(value);
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

function ConfirmModal({ item, onDone }: { item: Pending; onDone: (value: string | null) => void }) {
  const okRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(item.defaultValue ?? "");
  const danger = item.tone ? item.tone === "danger" : !item.alert && DANGER.test(item.message);
  const success = item.tone === "success";
  const { title, body } = splitMessage(item);
  const blocked = item.mustEqual != null && value.trim() !== item.mustEqual;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    } else {
      okRef.current?.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onDone(null);
      }
    };
    // Yakalama evresinde: altta açık pencerenin Escape'i tetiklenmesin.
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [onDone]);

  const Icon = danger ? AlertTriangle : success ? CheckCircle2 : item.alert ? Info : HelpCircle;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDone(null);
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!blocked) onDone(item.prompt ? value : "");
        }}
        role={item.alert ? "dialog" : "alertdialog"}
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={body ? "confirm-body" : undefined}
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl"
      >
        <div className="flex gap-3.5">
          <span
            className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
              danger
                ? "bg-rose-50 text-rose-600"
                : success
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-zinc-100 text-zinc-700"
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
        {item.prompt ? (
          <input
            ref={inputRef}
            type={item.inputType ?? "text"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={item.placeholder ?? item.mustEqual}
            aria-label={title}
            autoComplete="off"
            className="mt-4 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          {item.alert ? null : (
          <button
            type="button"
            onClick={() => onDone(null)}
            className="inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"
          >
            {item.cancelLabel ?? "Vazgeç"}
          </button>
          )}
          <button
            ref={okRef}
            type="submit"
            disabled={blocked}
            className={`inline-flex h-9 items-center rounded-full px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 ${
              danger
                ? "bg-rose-600 hover:bg-rose-700 focus-visible:outline-rose-600"
                : "bg-[#141111] hover:bg-[#e91825] focus-visible:outline-[#e91825]"
            }`}
          >
            {item.confirmLabel ??
              (item.alert ? "Tamam" : danger ? "Evet, devam et" : item.prompt ? "Kaydet" : "Onayla")}
          </button>
        </div>
      </form>
    </div>
  );
}
