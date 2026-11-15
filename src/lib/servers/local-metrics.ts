import { statfs } from "node:fs/promises";
import os from "node:os";
import type { MetricSnapshot } from "./types";

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.irq + c.times.idle;
  }
  return { idle, total };
}

/**
 * Panelin çalıştığı makinenin ölçümü (SERVER_MONITOR_LOCAL). Container içinde
 * bellek ve CPU host değerleridir (limit yoksa); disk, Docker'ın durduğu
 * bölümdür. Ağ sayacı okunmaz.
 */
export async function localMetrics(): Promise<MetricSnapshot> {
  const a = cpuTimes();
  await new Promise((r) => setTimeout(r, 500));
  const b = cpuTimes();
  const dt = b.total - a.total;
  const fs = await statfs("/");
  const diskTotal = fs.blocks * fs.bsize;
  const diskFree = fs.bavail * fs.bsize;
  const GB = 1024 ** 3;
  return {
    cpuPct: dt > 0 ? (1 - (b.idle - a.idle) / dt) * 100 : null,
    memPct: (1 - os.freemem() / os.totalmem()) * 100,
    memTotalGb: os.totalmem() / GB,
    diskPct: diskTotal > 0 ? (1 - diskFree / diskTotal) * 100 : null,
    diskTotalGb: diskTotal / GB,
    netInMb: null,
    netOutMb: null,
    uptimeSec: Math.round(os.uptime()),
    os: `${os.type()} ${os.release()}`,
    kernel: os.release(),
    arch: os.arch(),
    cpuModel: os.cpus()[0]?.model ?? null,
    cpuCores: os.cpus().length,
  };
}
