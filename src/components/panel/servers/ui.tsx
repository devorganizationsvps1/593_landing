"use client";

/**
 * Sunucu yönetimi ortak parçaları. Tasarım kuralı: içerik tek bir çerçevenin
 * içinde, ince çizgilerle bölünür — gölge, havada duran kart, renkli rozet yok.
 * Renk yalnızca durum bildirir (yeşil / sarı / kırmızı) ve her zaman yazıyla gelir.
 */

export type Tone = "ok" | "warn" | "critical" | "unknown";

export const FRAME = "overflow-hidden rounded-[10px] border border-panel-border-strong bg-panel-surface";
export const RULE = "border-panel-border";

export const TONE_DOT: Record<Tone, string> = {
  ok: "bg-panel-ok",
  warn: "bg-panel-warn",
  critical: "bg-panel-critical",
  unknown: "bg-panel-border-strong",
};

export const TONE_TEXT: Record<Tone, string> = {
  ok: "text-panel-fg",
  warn: "text-panel-warn",
  critical: "text-panel-critical",
  unknown: "text-panel-fg-secondary",
};

/** Durum: renkli nokta + yazı. Sorun yoksa yazı nötr kalır. */
export function Status({ tone, children, className = "" }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-[13px] font-medium ${TONE_TEXT[tone]} ${className}`}>
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} />
      {children}
    </span>
  );
}

const btn =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-[13px] font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e91825] disabled:pointer-events-none disabled:opacity-50";
export const BTN = `${btn} border border-panel-border-strong bg-panel-surface text-panel-fg hover:border-panel-fg`;
export const BTN_SOLID = `${btn} bg-[#141111] text-white hover:bg-[#e91825]`;
export const BTN_QUIET = `${btn} text-panel-fg-secondary hover:bg-panel-surface-muted hover:text-panel-fg`;
export const FIELD =
  "h-9 w-full rounded-md border border-panel-border-strong bg-panel-surface px-3 text-[13px] text-panel-fg placeholder:text-panel-fg-muted focus:border-panel-fg focus:outline-none";
export const LABEL = "block text-[13px] font-medium text-panel-fg-secondary";

const TZ = "Europe/Istanbul";
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("tr-TR", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" }) : "—";
export const fmtDateShort = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("tr-TR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
export const fmtDateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("tr-TR", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";
export const pct = (v: number | null | undefined, d = 0) =>
  v == null ? "—" : `%${v.toLocaleString("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d })}`;

export function age(iso: string | null | undefined): string {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "bugün";
  if (days < 31) return `${days} gün`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} ay`;
  const years = Math.floor(months / 12);
  return months % 12 ? `${years} yıl ${months % 12} ay` : `${years} yıl`;
}

export async function post(body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch("/api/panel/servers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  return { ok: res.ok, data };
}

/** Aynı sayfada adres çubuğunu güncelleyen bağlantı — sunucuya gitmez, anında geçer. */
export function SoftLink({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      {...rest}
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        window.history.pushState(null, "", href);
      }}
    >
      {children}
    </a>
  );
}
