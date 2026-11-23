"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { TaskSummary } from "@/lib/panel/board-summary";

const SUMMARY_URL = "/api/panel/board/summary";
const EVERY_MS = 2 * 60 * 1000;

/**
 * Üst çubukta günlük görev özeti. Her sayı panoyu ilgili hızlı filtreyle açar.
 * Görüntüleyici hesaplarda API 403 döner → hiçbir şey gösterilmez.
 */
export default function HeaderTaskSummary() {
  const pathname = usePathname();
  const [data, setData] = useState<TaskSummary | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(SUMMARY_URL, { cache: "no-store" });
        if (!res.ok) return;
        const d = (await res.json()) as TaskSummary;
        if (alive && typeof d.dueToday === "number") setData(d);
      } catch {
        // Ağ hatası: eldeki değer kalır.
      }
    };
    load();
    const id = window.setInterval(load, EVERY_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
    // Sayfa değişince (ör. panoda kart taşındıktan sonra) tazele.
  }, [pathname]);

  if (!data) return null;

  const mine = data.scope === "mine" && data.userId ? `&assignee=${data.userId}` : "";
  const who = data.scope === "mine" ? "Size atanan" : "Tüm panoda";

  return (
    <nav
      aria-label="Görev özeti"
      className="hidden shrink-0 items-center gap-1 md:flex"
    >
      <Stat
        href={`/board?today=1${mine}`}
        label="Bugün teslim"
        value={data.dueToday}
        title={`${who}, son tarihi bugün olan görevler`}
        tone="amber"
      />
      <Stat
        href={`/board?review=1${mine}`}
        label="Onay bekleyen"
        value={data.review}
        title={`${who}, İncelemede kolonundaki görevler`}
        tone="sky"
      />
      <Stat
        href={`/board?overdue=1${mine}`}
        label="Geciken"
        value={data.overdue}
        title={`${who}, son tarihi geçmiş görevler`}
        tone="rose"
      />
    </nav>
  );
}

const TONES = {
  amber: "bg-amber-50 text-amber-800 ring-amber-200 hover:bg-amber-100",
  sky: "bg-sky-50 text-sky-800 ring-sky-200 hover:bg-sky-100",
  rose: "bg-rose-50 text-rose-700 ring-rose-200 hover:bg-rose-100",
} as const;

function Stat({
  href,
  label,
  value,
  title,
  tone,
}: {
  href: string;
  label: string;
  value: number;
  title: string;
  tone: keyof typeof TONES;
}) {
  const active = value > 0;
  return (
    <Link
      href={href}
      title={title}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium ring-1 ring-inset transition ${
        active
          ? TONES[tone]
          : "bg-panel-surface-muted text-panel-fg-muted ring-panel-border hover:text-panel-fg"
      }`}
    >
      <span>{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </Link>
  );
}
