/**
 * Marka ↔ Facebook sayfası ad eşleştirmesi (toplu bağlama önerisi).
 * Saf fonksiyonlar — istemci ve sunucu ortak kullanabilir.
 */

/** Marka adlarında eşleşmeyi bozan, ayırt edici olmayan kelimeler. */
const STOP = new Set([
  "593",
  "ads",
  "bm",
  "insta",
  "instagram",
  "reklam",
  "hesabi",
  "yeni",
  "il",
  "official",
  "resmi",
]);

const TR_MAP: Record<string, string> = {
  ı: "i",
  İ: "i",
  ş: "s",
  ç: "c",
  ğ: "g",
  ö: "o",
  ü: "u",
  â: "a",
  î: "i",
  û: "u",
};

function fold(s: string): string {
  return s
    .replace(/[ıİşçğöüâîû]/g, (c) => TR_MAP[c] ?? c)
    .toLocaleLowerCase("en")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function nameTokens(s: string): string[] {
  return fold(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

function compact(s: string): string {
  return fold(s).replace(/[^a-z0-9]/g, "");
}

function tokenMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.startsWith(short);
}

export type MatchPage = {
  pageId: string;
  pageName: string;
  instagram: { username: string | null } | null;
};
export type MatchTenant = { slug: string; name: string };

/** 0..1 arası benzerlik: ortak kelime oranı (Dice) + slug ↔ Instagram kullanıcı adı ipucu. */
export function matchScore(tenant: MatchTenant, page: MatchPage): number {
  const a = nameTokens(tenant.name);
  const b = nameTokens(page.pageName);
  let score = 0;
  if (a.length && b.length) {
    const used = new Set<number>();
    let hits = 0;
    for (const t of a) {
      const j = b.findIndex((u, i) => !used.has(i) && tokenMatch(t, u));
      if (j >= 0) {
        used.add(j);
        hits++;
      }
    }
    score = (2 * hits) / (a.length + b.length);
  }
  // Slug'ın sonundaki rastgele ek (-6582) atılır.
  const slug = compact(tenant.slug.replace(/-\d{3,}$/, ""));
  const ig = compact(page.instagram?.username ?? "");
  if (
    slug.length >= 5 &&
    ig.length >= 5 &&
    (ig.startsWith(slug) || slug.startsWith(ig))
  ) {
    score = Math.min(1, score + 0.5);
  }
  return score;
}

export const MATCH_THRESHOLD = 0.5;

/**
 * Her markaya en iyi sayfayı önerir; bir sayfa yalnızca bir markaya önerilir
 * (en yüksek puan önce). Listede önce gelen marka eşitlikte önceliklidir.
 */
export function suggestPages(
  tenants: MatchTenant[],
  pages: MatchPage[],
): Map<string, { pageId: string; score: number }> {
  const pairs: {
    slug: string;
    pageId: string;
    score: number;
    order: number;
  }[] = [];
  tenants.forEach((t, order) => {
    for (const p of pages) {
      const score = matchScore(t, p);
      if (score >= MATCH_THRESHOLD)
        pairs.push({ slug: t.slug, pageId: p.pageId, score, order });
    }
  });
  pairs.sort((x, y) => y.score - x.score || x.order - y.order);
  const out = new Map<string, { pageId: string; score: number }>();
  const taken = new Set<string>();
  for (const p of pairs) {
    if (out.has(p.slug) || taken.has(p.pageId)) continue;
    out.set(p.slug, { pageId: p.pageId, score: p.score });
    taken.add(p.pageId);
  }
  return out;
}
