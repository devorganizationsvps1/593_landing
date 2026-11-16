/**
 * Hosting takibi — her firma (Dokploy projesi) için 1 yıllık dönem.
 * İlk görüldüğünde dönem bitişi, projenin açılış tarihinin bir sonraki yıl
 * dönümü olarak kaydedilir; sonrasında yalnızca "Ödeme alındı" ilerletir,
 * böylece süresi dolan firma ödeme alınana kadar "doldu" olarak kalır.
 */
import { prisma } from "@/lib/db";
import { loadInventory } from "./dokploy";
import type { Inventory, ProjectInfo } from "./types";

export type HostingRow = {
  key: string;
  name: string;
  domain: string | null;
  serverName: string;
  /** Projenin Dokploy'da açıldığı gün. */
  openedAt: string | null;
  periodStart: string;
  periodEnd: string;
  totalDays: number;
  /** Dönemde geçen gün (dönem dolduysa totalDays). */
  elapsedDays: number;
  /** Negatifse süre o kadar gün önce dolmuştur. */
  daysLeft: number;
  yearlyFee: number | null;
  currency: string;
  note: string | null;
  hidden: boolean;
};

const DAY = 86_400_000;
const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export function addYears(d: Date, n: number): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear() + n, d.getUTCMonth(), d.getUTCDate()));
  // 29 Şubat → 28 Şubat
  if (out.getUTCMonth() !== d.getUTCMonth()) out.setUTCDate(0);
  return out;
}

/** Açılış tarihinin bugünden sonraki ilk yıl dönümü. */
function nextAnniversary(opened: Date, today: Date): Date {
  let end = addYears(opened, 1);
  while (end <= today) end = addYears(end, 1);
  return end;
}

export const hostingKey = (instanceId: string, projectId: string) => `${instanceId}:${projectId}`;

function projectInstance(inv: Inventory, p: ProjectInfo): string | null {
  return p.services[0]?.serverKey.split(":")[0] ?? inv.servers[0]?.instanceId ?? null;
}

export function hostingPeriod(paidUntil: Date, now = new Date()) {
  const today = utcDay(now);
  const end = utcDay(paidUntil);
  const start = addYears(end, -1);
  const totalDays = Math.round((end.getTime() - start.getTime()) / DAY);
  const daysLeft = Math.round((end.getTime() - today.getTime()) / DAY);
  return { start, end, totalDays, daysLeft, elapsedDays: Math.min(totalDays, Math.max(0, totalDays - daysLeft)) };
}

export async function loadHosting(): Promise<HostingRow[]> {
  const inv = await loadInventory();
  const today = utcDay(new Date());
  const projects = inv.projects
    .map((p) => ({ p, inst: projectInstance(inv, p) }))
    .filter((x): x is { p: ProjectInfo; inst: string } => x.inst != null);
  const keys = projects.map(({ p, inst }) => hostingKey(inst, p.id));
  const existing = new Map(
    (await prisma.hostingAccount.findMany({ where: { key: { in: keys } } })).map((a) => [a.key, a]),
  );

  const missing = projects
    .filter(({ p, inst }) => !existing.has(hostingKey(inst, p.id)))
    .map(({ p, inst }) => ({
      key: hostingKey(inst, p.id),
      paidUntil: nextAnniversary(utcDay(p.createdAt ? new Date(p.createdAt) : today), today),
    }));
  if (missing.length) {
    await prisma.hostingAccount.createMany({ data: missing, skipDuplicates: true });
    for (const a of await prisma.hostingAccount.findMany({ where: { key: { in: missing.map((m) => m.key) } } })) {
      existing.set(a.key, a);
    }
  }

  const rows: HostingRow[] = [];
  for (const { p, inst } of projects) {
    const a = existing.get(hostingKey(inst, p.id));
    if (!a) continue;
    const period = hostingPeriod(a.paidUntil);
    const serverKey = p.services[0]?.serverKey;
    rows.push({
      key: a.key,
      name: p.name,
      domain: p.services.flatMap((s) => s.domains)[0]?.host ?? null,
      serverName: inv.servers.find((s) => s.key === serverKey)?.name ?? "",
      openedAt: p.createdAt,
      periodStart: period.start.toISOString().slice(0, 10),
      periodEnd: period.end.toISOString().slice(0, 10),
      totalDays: period.totalDays,
      elapsedDays: period.elapsedDays,
      daysLeft: period.daysLeft,
      yearlyFee: a.yearlyFee != null ? Number(a.yearlyFee) : null,
      currency: a.currency,
      note: a.note,
      hidden: a.hidden,
    });
  }
  return rows.sort((x, y) => x.daysLeft - y.daysLeft);
}

/** "Ödeme alındı": dönem 1 yıl ileri alınır. */
export async function markHostingPaid(key: string) {
  const a = await prisma.hostingAccount.findUnique({ where: { key } });
  if (!a) throw new Error("Hosting kaydı bulunamadı");
  return prisma.hostingAccount.update({ where: { key }, data: { paidUntil: addYears(utcDay(a.paidUntil), 1) } });
}
