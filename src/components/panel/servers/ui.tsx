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
  ok: "bg-[#16a34a]",
  warn: "bg-amber-500",
  critical: "bg-rose-600",
  unknown: "bg-panel-border-strong",
};

export const TONE_TEXT: Record<Tone, string> = {
  ok: "text-panel-fg",
  warn: "text-panel-warn",
  critical: "text-panel-critical",
  unknown: "text-panel-fg-secondary",
};

/**
 * Durum etiketi — Durum panosundaki dolu etiketlerle aynı dil: sorun kırmızı,
 * uyarı sarı dolu; sorun yoksa yeşil nokta + yazı. `onColor` renkli zemin içindir.
 */
export function Status({
  tone,
  children,
  className = "",
  onColor = false,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
  onColor?: boolean;
}) {
  if (onColor) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold ${
          tone === "critical" || tone === "warn" ? "bg-white text-zinc-900" : "bg-white/20 text-white"
        } ${className}`}
      >
        {tone === "critical" || tone === "warn" ? <span aria-hidden className={`size-2 rounded-full ${TONE_DOT[tone]}`} /> : null}
        {children}
      </span>
    );
  }
  if (tone === "critical" || tone === "warn") {
    return (
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-semibold ${
          tone === "critical" ? "bg-rose-600 text-white" : "bg-amber-400 text-amber-950"
        } ${className}`}
      >
        {children}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-2 text-[13px] font-medium ${TONE_TEXT[tone]} ${className}`}>
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} />
      {children}
    </span>
  );
}

/** Durum panosunun ekip renkleri (lib/panel/teams.ts) — kimlik rengi olarak. */
export const BOARD_COLORS = ["#0866FF", "#7C3AED", "#E1306C", "#E37400", "#34A853", "#0F766E"] as const;
/**
 * Renk ataması: en eski proje ilk rengi alır, sırayla döner. Böylece yan yana
 * kutular farklı renkte olur ve yeni proje eklenince eskilerin rengi değişmez.
 */
export function colorMap(items: Array<{ id: string; createdAt: string | null }>): Map<string, string> {
  const sorted = [...items].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id));
  return new Map(sorted.map((it, i) => [it.id, BOARD_COLORS[i % BOARD_COLORS.length]]));
}

const btn =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-[13px] font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e91825] disabled:pointer-events-none disabled:opacity-50";
export const BTN = `${btn} border border-panel-border-strong bg-panel-surface text-panel-fg hover:border-panel-fg`;
export const BTN_SOLID = `${btn} bg-[#e91825] text-white hover:bg-[#c91420]`;
export const BTN_QUIET = `${btn} text-panel-fg-secondary hover:bg-panel-surface-muted hover:text-panel-fg`;
export const FIELD =
  "h-9 w-full rounded-md border border-panel-border-strong bg-panel-surface px-3 text-[13px] text-panel-fg placeholder:text-panel-fg-muted focus:border-[#e91825] focus:outline-none";
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
