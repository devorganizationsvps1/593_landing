"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AXIS_TICK,
  GOOGLE_COLOR,
  GRID,
  META_COLOR,
  STATUS_ERROR,
  TOOLTIP_STYLE,
} from "@/components/panel/ds/chart-theme";
import type { SeriesPoint } from "@/lib/servers/queries";
import type { RangeKey } from "@/lib/servers/types";

/** Seri renkleri: panelin CVD doğrulamalı çifti (bkz. chart-theme). */
const A = META_COLOR;
const B = GOOGLE_COLOR;

type Series = { key: keyof SeriesPoint; label: string; color: string };

function tickLabel(t: number, range: RangeKey): string {
  const d = new Date(t);
  return range === "24h"
    ? d.toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit" });
}

function fullLabel(t: number): string {
  return new Date(t).toLocaleString("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function TooltipBox({
  active,
  label,
  payload,
  series,
  unit,
  digits,
}: {
  active?: boolean;
  label?: number | string;
  payload?: ReadonlyArray<{ dataKey?: unknown; value?: unknown }>;
  series: Series[];
  unit: string;
  digits: number;
}) {
  if (!active || !payload?.length || typeof label !== "number") return null;
  return (
    <div style={TOOLTIP_STYLE} className="px-3 py-2">
      <p className="mb-1 text-[11px] text-panel-fg-secondary">{fullLabel(label)}</p>
      {series.map((s) => {
        const v = payload.find((p) => p.dataKey === s.key)?.value;
        return (
          <p key={s.key} className="flex items-center gap-2 tabular-nums">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />
            <span className="text-panel-fg-secondary">{s.label}</span>
            <span className="ml-auto pl-3 font-semibold text-panel-fg">
              {typeof v === "number" ? `${v.toLocaleString("tr-TR", { maximumFractionDigits: digits })}${unit}` : "—"}
            </span>
          </p>
        );
      })}
    </div>
  );
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-4 text-xs text-panel-fg-secondary">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function Frame({
  title,
  note,
  series,
  empty,
  children,
}: {
  title: string;
  note?: string;
  series: Series[];
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[15px] font-semibold text-panel-fg">{title}</h3>
          {note ? <p className="text-[13px] text-panel-fg-secondary">{note}</p> : null}
        </div>
        <Legend series={series} />
      </div>
      <div className="h-52 w-full">
        {empty ? (
          <div className="flex h-full items-center justify-center bg-panel-surface-muted px-4 text-center text-[13px] text-panel-fg-secondary">
            Bu aralıkta henüz ölçüm yok. Ölçümler 5 dakikada bir kaydedilir.
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

const hasData = (data: SeriesPoint[], keys: Array<keyof SeriesPoint>) =>
  data.some((p) => keys.some((k) => p[k] != null));

/** 7/30 günde eksen işaretleri İstanbul gece yarılarına oturur (aynı gün iki kez yazılmasın). */
function dayTicks(data: SeriesPoint[], range: RangeKey): number[] | undefined {
  if (range === "24h" || data.length < 2) return undefined;
  const DAY = 86_400_000;
  const OFFSET = 3 * 3_600_000;
  const step = range === "30d" ? 5 : 1;
  const out: number[] = [];
  const first = Math.ceil((data[0].t + OFFSET) / DAY) * DAY - OFFSET;
  for (let t = first; t <= data[data.length - 1].t; t += step * DAY) out.push(t);
  return out.length >= 2 ? out : undefined;
}

function axes(data: SeriesPoint[], range: RangeKey, unit: string, domain?: [number, number]) {
  return (
    <>
      <CartesianGrid stroke={GRID} vertical={false} />
      <XAxis
        dataKey="t"
        type="number"
        scale="time"
        domain={["dataMin", "dataMax"]}
        tickFormatter={(t: number) => tickLabel(t, range)}
        tick={AXIS_TICK}
        axisLine={false}
        tickLine={false}
        ticks={dayTicks(data, range)}
        minTickGap={48}
      />
      <YAxis
        domain={domain ?? [0, "auto"]}
        tickFormatter={(v: number) => `${v.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}${unit}`}
        tick={AXIS_TICK}
        axisLine={false}
        tickLine={false}
        width={52}
      />
    </>
  );
}

export function ServerCharts({
  data,
  range,
  diskWarnPct,
}: {
  data: SeriesPoint[];
  range: RangeKey;
  diskWarnPct: number;
}) {
  const load: Series[] = [
    { key: "cpu", label: "CPU", color: A },
    { key: "mem", label: "RAM", color: B },
  ];
  const disk: Series[] = [{ key: "disk", label: "Disk", color: A }];
  const net: Series[] = [
    { key: "netIn", label: "Gelen", color: A },
    { key: "netOut", label: "Giden", color: B },
  ];
  const margin = { top: 8, right: 8, left: 0, bottom: 0 };

  return (
    <div className="grid divide-y divide-panel-border lg:grid-cols-2 lg:[&>*:nth-child(2)]:border-r lg:[&>*:nth-child(2)]:border-panel-border lg:[&>*:nth-child(3)]:border-t lg:[&>*:nth-child(3)]:border-panel-border">
      <div className="lg:col-span-2">
        <Frame title="CPU ve RAM kullanımı" note="Yüzde; çizgideki boşluklar ölçüm alınamayan anlardır." series={load} empty={!hasData(data, ["cpu", "mem"])}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={margin}>
              {axes(data, range, "%", [0, 100])}
              <Tooltip content={(p) => <TooltipBox {...p} series={load} unit="%" digits={1} />} />
              {load.map((s) => (
                <Line key={s.key} dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Frame>
      </div>
      <Frame title="Disk doluluğu" note={`Kesikli çizgi uyarı eşiği (%${diskWarnPct}).`} series={disk} empty={!hasData(data, ["disk"])}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={margin}>
            {axes(data, range, "%", [0, 100])}
            <Tooltip content={(p) => <TooltipBox {...p} series={disk} unit="%" digits={1} />} />
            <ReferenceLine y={diskWarnPct} stroke={STATUS_ERROR} strokeDasharray="4 4" strokeWidth={1} />
            <Area dataKey="disk" stroke={A} strokeWidth={2} fill={A} fillOpacity={0.12} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </Frame>
      <Frame title="Ağ trafiği" note="MB/sn, ardışık ölçümlerin farkından." series={net} empty={!hasData(data, ["netIn", "netOut"])}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={margin}>
            {axes(data, range, "")}
            <Tooltip content={(p) => <TooltipBox {...p} series={net} unit=" MB/sn" digits={3} />} />
            {net.map((s) => (
              <Line key={s.key} dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </Frame>
    </div>
  );
}
