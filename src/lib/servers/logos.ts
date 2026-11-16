import { prisma } from "@/lib/db";
import { matchBrandLogoLoose, resolveBrandCover } from "@/lib/panel/brand-logos";
import type { ProjectInfo } from "./types";

const hostOf = (url: string | null): string | null => {
  if (!url) return null;
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
};

/**
 * Proje → marka logosu. Önce sitesi projenin domainiyle aynı olan marka
 * (paneldeki kapak / logo), sonra ada göre gevşek eşleşme. Bulunamazsa null;
 * arayüz sitenin kendi favicon'una, o da yoksa baş harfe düşer.
 */
export async function projectLogos(projects: ProjectInfo[]): Promise<Map<string, string | null>> {
  const tenants = await prisma.tenant.findMany({ select: { slug: true, name: true, website: true, coverUrl: true } });
  const byHost = new Map<string, (typeof tenants)[number]>();
  for (const t of tenants) {
    const h = hostOf(t.website);
    if (h) byHost.set(h, t);
  }
  const out = new Map<string, string | null>();
  for (const p of projects) {
    const hosts = p.services.flatMap((s) => s.domains.map((d) => d.host.replace(/^www\./, "")));
    const tenant = hosts.map((h) => byHost.get(h)).find(Boolean);
    out.set(
      p.id,
      (tenant ? resolveBrandCover(tenant)?.src : null) ?? matchBrandLogoLoose([p.name, ...hosts.map((h) => h.split(".")[0])]),
    );
  }
  return out;
}
