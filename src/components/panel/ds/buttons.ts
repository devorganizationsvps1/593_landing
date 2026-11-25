/**
 * Panel buton / chip sınıfları — landing paletinden: mürekkep #141111,
 * beyaz, vurgu #e91825. Dokunma hedefi en az 40px.
 */

const base =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold whitespace-nowrap transition duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e91825] disabled:pointer-events-none disabled:opacity-50";

/** Ana eylem — koyu zemin, hover'da marka kırmızısı. */
export const btnPrimary = `${base} bg-[#141111] text-white hover:bg-[#e91825] hover:text-white`;

/** İkincil eylem — beyaz zemin, belirgin kenarlık. */
export const btnSecondary = `${base} border border-zinc-300 bg-white text-[#141111] hover:border-[#141111]`;

/** Metin benzeri, düşük vurgulu eylem. */
export const btnGhost = `${base} text-zinc-600 hover:bg-zinc-100 hover:text-[#141111]`;

/** Seçilebilir filtre / sekme. Seçili = dolu koyu. */
export function chipClass(active: boolean): string {
  return active
    ? `${base} border border-[#141111] bg-[#141111] text-white`
    : `${base} border border-zinc-300 bg-white text-zinc-700 hover:border-[#141111] hover:text-[#141111]`;
}

/** Arama / select alanı — butonlarla aynı yükseklik. */
export const fieldClass =
  "min-h-10 rounded-full border border-zinc-300 bg-white px-4 text-sm text-[#141111] placeholder:text-zinc-400 focus:border-[#141111] focus:outline-none";

/* ── Araç çubuğu (yoğun filtre satırları) ──
 * Kenarlıksız, yumuşak dolgulu haplar: yan yana çok kontrol olunca kenarlıklı
 * kutular sert görünüyor. Yükseklik 32px (h-8). */

const toolBase =
  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e91825] disabled:pointer-events-none disabled:opacity-50";

const TOOL_ACTIVE = {
  ink: "bg-[#141111] text-white",
  rose: "bg-rose-100 text-rose-700",
  amber: "bg-amber-100 text-amber-800",
  sky: "bg-sky-100 text-sky-800",
} as const;

/** Araç çubuğu düğmesi / aç-kapa filtresi. Seçiliyken `tone` rengine döner. */
export function toolChip(active = false, tone: keyof typeof TOOL_ACTIVE = "ink"): string {
  return `${toolBase} ${
    active ? TOOL_ACTIVE[tone] : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200/70 hover:text-zinc-900"
  }`;
}

/** Araç çubuğundaki ana eylem (koyu hap). */
export const toolPrimary = `${toolBase} bg-[#141111] text-white hover:bg-[#e91825]`;

/** Araç çubuğu arama alanı — `pl-8 pr-7` ikon payını çağıran ekler. */
export const toolField =
  "h-8 w-full rounded-full border border-transparent bg-zinc-100 text-xs text-zinc-800 outline-none transition placeholder:text-zinc-400 hover:bg-zinc-200/60 focus:border-zinc-300 focus:bg-white";

/** Araç çubuğu select'i. Değer seçiliyken koyu dolar. */
export function toolSelect(active: boolean): string {
  return `h-8 max-w-[11rem] cursor-pointer appearance-none truncate rounded-full pl-3 pr-7 text-xs font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-zinc-300 ${
    active ? "bg-[#141111] text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200/70 hover:text-zinc-900"
  }`;
}
