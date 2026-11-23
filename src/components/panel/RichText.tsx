export const URL_RE = /https?:\/\/[^\s<>"'()]+/gi;

/**
 * Notlarda kullanılabilen yazı renkleri. Metinde `{red}…{/red}` biçiminde
 * saklanır; kalın için `**…**`. Düz metin olarak da okunaklı kalır.
 */
export const TEXT_COLORS = [
  { key: "red", label: "Kırmızı", className: "text-red-600", swatch: "#dc2626" },
  { key: "orange", label: "Turuncu", className: "text-orange-600", swatch: "#ea580c" },
  { key: "green", label: "Yeşil", className: "text-green-600", swatch: "#16a34a" },
  { key: "blue", label: "Mavi", className: "text-blue-600", swatch: "#2563eb" },
  { key: "purple", label: "Mor", className: "text-purple-600", swatch: "#9333ea" },
] as const;

export type TextColorKey = (typeof TEXT_COLORS)[number]["key"];

const COLOR_KEYS = TEXT_COLORS.map((c) => c.key).join("|");
const TOKEN_RE = new RegExp(`\\*\\*|\\{(${COLOR_KEYS})\\}|\\{\\/(${COLOR_KEYS})\\}`, "g");

type Segment = { text: string; bold: boolean; color: TextColorKey | null };

/**
 * Metni biçim parçalarına ayırır. Eşi olmayan işaret düz metin kalır;
 * kalın ve renk iç içe (her iki sırada) kullanılabilir.
 */
function parseFormatting(text: string): Segment[] {
  const tokens = [...text.matchAll(TOKEN_RE)].map((m) => ({
    index: m.index ?? 0,
    raw: m[0],
    kind: m[0] === "**" ? ("bold" as const) : m[1] ? ("open" as const) : ("close" as const),
    key: (m[1] ?? m[2] ?? null) as TextColorKey | null,
    valid: false,
  }));
  // Kalın: ardışık çiftler; tek kalan düz metin.
  const bolds = tokens.filter((t) => t.kind === "bold");
  for (let i = 0; i + 1 < bolds.length; i += 2) {
    bolds[i].valid = true;
    bolds[i + 1].valid = true;
  }
  // Renk: aynı anahtarın açılış/kapanışı eşleşir.
  const open: Partial<Record<TextColorKey, typeof tokens>> = {};
  for (const t of tokens) {
    if (!t.key) continue;
    const stack = (open[t.key] ??= []);
    if (t.kind === "open") stack.push(t);
    else if (stack.length > 0) {
      stack.pop()!.valid = true;
      t.valid = true;
    }
  }

  const out: Segment[] = [];
  let bold = false;
  const colors: TextColorKey[] = [];
  let last = 0;
  const push = (end: number) => {
    if (end > last) {
      out.push({ text: text.slice(last, end), bold, color: colors.at(-1) ?? null });
    }
  };
  for (const t of tokens) {
    if (!t.valid) continue;
    push(t.index);
    last = t.index + t.raw.length;
    if (t.kind === "bold") bold = !bold;
    else if (t.kind === "open") colors.push(t.key!);
    else {
      const at = colors.lastIndexOf(t.key!);
      if (at >= 0) colors.splice(at, 1);
    }
  }
  push(text.length);
  return out;
}

/** Biçim işaretlerini kaldırır (önizleme / arama / bildirim metni için). */
export function stripFormatting(text: string): string {
  return parseFormatting(text)
    .map((s) => s.text)
    .join("");
}

/** Uzun bağlantının okunur kısa hali: alan adı + yol, gerekirse ortası kısaltılmış. */
export function shortUrl(href: string, max = 48): string {
  let label = href;
  try {
    const u = new URL(href);
    label = `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    // Geçersiz URL — ham metni göster.
  }
  return label.length > max ? `${label.slice(0, max - 13)}…${label.slice(-12)}` : label;
}

function Links({ text, compactLinks }: { text: string; compactLinks: boolean }) {
  const parts: Array<{ kind: "text" | "link"; value: string }> = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    const url = m[0].replace(/[.,;:!?]+$/, "");
    if (start > last) parts.push({ kind: "text", value: text.slice(last, start) });
    parts.push({ kind: "link", value: url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "link" ? (
          <a
            key={i}
            href={p.value}
            title={compactLinks ? p.value : undefined}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="break-all text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900"
          >
            {compactLinks ? shortUrl(p.value) : p.value}
          </a>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </>
  );
}

/**
 * Metin içindeki linkleri yerinde tıklanabilir yapar; satır sonları korunur.
 * `**kalın**` ve `{renk}…{/renk}` biçimlerini uygular.
 * `compactLinks`: link kısa etiketle görünür, tam adres fare üstünde.
 */
export function RichText({ text, compactLinks = false }: { text: string; compactLinks?: boolean }) {
  return (
    <>
      {parseFormatting(text).map((seg, i) => {
        const inner = <Links text={seg.text} compactLinks={compactLinks} />;
        if (!seg.bold && !seg.color) return <span key={i}>{inner}</span>;
        const cls = [
          seg.bold ? "font-semibold" : "",
          TEXT_COLORS.find((c) => c.key === seg.color)?.className ?? "",
        ]
          .filter(Boolean)
          .join(" ");
        return seg.bold ? (
          <strong key={i} className={cls}>
            {inner}
          </strong>
        ) : (
          <span key={i} className={cls}>
            {inner}
          </span>
        );
      })}
    </>
  );
}
