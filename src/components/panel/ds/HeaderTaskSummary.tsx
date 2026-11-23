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
      className="hidden shrink-0 items-stretch divide-x divide-panel-border overflow-hidden rounded-panel-btn border border-panel-border bg-panel-surface md:flex"
    >
      <Stat
        href={`/board?today=1${mine}`}
        label="bugün teslim"
        value={data.dueToday}
        title={`${who}, son tarihi bugün olan görevler`}
      />
      <Stat
        href={`/board?review=1${mine}`}
        label="onay bekliyor"
        value={data.review}
        title={`${who}, İncelemede kolonundaki görevler`}
      />
      <Stat
        href={`/board?overdue=1${mine}`}
        label="gecikti"
        value={data.overdue}
        title={`${who}, son tarihi geçmiş görevler`}
        alert
      />
    </nav>
  );
}

function Stat({
  href,
  label,
  value,
  title,
  alert = false,
}: {
  href: string;
  label: string;
  value: number;
  title: string;
  /** Sıfırdan büyükse sayı kırmızı (gecikenler). */
  alert?: boolean;
}) {
  const active = value > 0;
  return (
    <Link
      href={href}
      title={title}
      className="group inline-flex items-baseline gap-1.5 whitespace-nowrap px-3 py-1.5 transition hover:bg-panel-surface-muted"
    >
      <span
        className={`text-[13px] font-semibold tabular-nums ${
          !active ? "text-panel-fg-muted" : alert ? "text-rose-600" : "text-panel-fg"
        }`}
      >
        {value}
      </span>
      <span className="text-[12px] text-panel-fg-secondary group-hover:text-panel-fg">
        {label}
      </span>
    </Link>
  );
}
