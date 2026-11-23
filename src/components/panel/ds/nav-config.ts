/** Shared nav paths — no React components (safe for RSC → client props). */
import { can, type Permission } from "@/lib/panel/permissions";

export type PanelNavLink = {
  href: string;
  label: string;
  /** Platform sayfası — markada bu entegrasyon kapalıysa menüde gizlenir. */
  integration?: string;
  /** Yalnızca bu yetkiye sahip rollerde menüde görünür. */
  permission?: Permission;
};

export const TENANT_NAV_LINKS: PanelNavLink[] = [
  { href: "/", label: "Sunum" },
  { href: "/meta", label: "Meta", integration: "meta" },
  { href: "/google", label: "Google Ads", integration: "google_ads" },
  { href: "/ga4", label: "GA4", integration: "ga4" },
  { href: "/gtm", label: "GTM", integration: "gtm" },
  { href: "/budget", label: "Bütçe" },
  { href: "/search-console", label: "GSC", integration: "gsc" },
];

export const STAFF_NAV_LINKS: PanelNavLink[] = [
  { href: "/brands", label: "Markalar" },
  { href: "/board", label: "Durum" },
  { href: "/kampanyalar", label: "Kampanyalar" },
  { href: "/toplantilar", label: "Toplantılar" },
  { href: "/notlar", label: "Notlar" },
  { href: "/takvim", label: "Takvim" },
  { href: "/paylasimlar", label: "Paylaşımlar" },
  { href: "/ekip", label: "Ekip" },
  { href: "/bildirimler", label: "Bildirimler" },
  { href: "/audit", label: "İşlem kaydı" },
  { href: "/oneriler", label: "Öneriler" },
  { href: "/yedekler", label: "Yedekler" },
  { href: "/sunucular", label: "Sunucu Yönetimi", permission: "servers.manage" },
  { href: "/settings", label: "Ayarlar" },
  { href: "/vardiya", label: "Shift" },
];

/** Role göre staff menüsü — yetki isteyen bağlantılar yetkisiz rolde hiç çıkmaz. */
export function staffNavLinks(role: string | null | undefined): PanelNavLink[] {
  return STAFF_NAV_LINKS.filter((l) => !l.permission || can(role, l.permission)).map(
    ({ href, label }) => ({ href, label }),
  );
}

const TENANT_CALENDAR_LINK: PanelNavLink = { href: "/takvim", label: "Paylaşım takvimi" };

/**
 * Markada kapatılan platformların sayfalarını menüden çıkarır; paylaşım
 * takvimi olan markalarda "Paylaşım takvimi" bağlantısını ekler.
 */
export function tenantNavLinks(
  disabled: readonly string[],
  opts: { calendar?: boolean } = {},
): PanelNavLink[] {
  const links = TENANT_NAV_LINKS.filter(
    (l) => !l.integration || !disabled.includes(l.integration),
  );
  return opts.calendar ? [...links, TENANT_CALENDAR_LINK] : links;
}

/** `/panel` rewrite önekini atar — tarayıcı yolu karşılaştırması için. */
function stripPanelPrefix(path: string): string {
  if (path === "/panel") return "/";
  return path.startsWith("/panel/") ? path.slice("/panel".length) : path;
}

function matches(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

export function staffPageTitle(rawPath: string): string {
  const path = stripPanelPrefix(rawPath);
  if (matches(path, "/board")) return "Durum tablosu";
  if (matches(path, "/kampanyalar")) return "Aktif kampanyalar";
  if (matches(path, "/toplantilar")) return "Toplantılar";
  if (matches(path, "/notlar")) return "Notlar";
  if (matches(path, "/takvim")) return "İçerik takvimi";
  if (matches(path, "/paylasimlar")) return "Paylaşımlar";
  if (matches(path, "/ekip")) return "Ekip";
  if (matches(path, "/vardiya")) return "Shift";
  if (matches(path, "/bildirimler")) return "Bildirimler";
  if (matches(path, "/settings")) return "Ayarlar";
  if (matches(path, "/oneriler")) return "Öneri kutusu";
  if (matches(path, "/audit")) return "İşlem kaydı";
  if (matches(path, "/yedekler")) return "Yedekler";
  if (matches(path, "/sunucular")) return "Sunucu Yönetimi";
  if (matches(path, "/brands/sync")) return "Veri çekimi";
  if (path.startsWith("/brands/")) return "Marka detayı";
  return "Markalar";
}

const TENANT_PAGE_TITLES: Record<string, string> = {
  "/meta": "Meta",
  "/google": "Google Ads",
  "/ga4": "GA4",
  "/gtm": "GTM",
  "/budget": "Bütçe",
  "/search-console": "Search Console",
  "/takvim": "Paylaşım takvimi",
};

export function tenantPageTitle(rawPath: string, brandName: string): string {
  const path = stripPanelPrefix(rawPath);
  return TENANT_PAGE_TITLES[path] ?? brandName;
}
