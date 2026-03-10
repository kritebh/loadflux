import os from "os";
import fs from "fs";
import type { SystemMetricRow } from "../types.js";

// Previous CPU snapshot for delta calculation
let prevCpuTimes: { idle: number; total: number } | null = null;
// Previous network snapshot (Linux only)
let prevNetBytes: { rx: number; tx: number } | null = null;

function getCpuPercent(): number {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.idle +
      cpu.times.irq;
  }

  if (!prevCpuTimes) {
    prevCpuTimes = { idle, total };
    return 0;
  }

  const idleDelta = idle - prevCpuTimes.idle;
  const totalDelta = total - prevCpuTimes.total;
  prevCpuTimes = { idle, total };

  if (totalDelta === 0) return 0;
  return Math.round(((1 - idleDelta / totalDelta) * 100) * 100) / 100;
}

function getMemory(): { total: number; used: number; percent: number } {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    total,
    used,
    percent: Math.round((used / total) * 100 * 100) / 100,
  };
}

function getDisk(): {
  total: number | null;
  used: number | null;
  percent: number | null;
} {
  try {
    // fs.statfsSync available in Node 18.15+
    const stats = fs.statfsSync("/");
    const total = stats.blocks * stats.bsize;
    const free = stats.bfree * stats.bsize;
    const used = total - free;
    return {
      total,
      used,
      percent: total > 0 ? Math.round((used / total) * 100 * 100) / 100 : null,
    };
  } catch {
    return { total: null, used: null, percent: null };
  }
}

function getNetwork(): { rx: number; tx: number } {
  // Linux only: parse /proc/net/dev
  if (process.platform !== "linux") {
    return { rx: 0, tx: 0 };
  }

  try {
    const content = fs.readFileSync("/proc/net/dev", "utf-8");
    const lines = content.split("\n").slice(2); // skip header lines
    let totalRx = 0;
    let totalTx = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("lo:")) continue; // skip loopback

      const parts = trimmed.split(/\s+/);
      if (parts.length >= 10) {
        totalRx += parseInt(parts[1], 10) || 0;
        totalTx += parseInt(parts[9], 10) || 0;
      }
    }

    if (!prevNetBytes) {
      prevNetBytes = { rx: totalRx, tx: totalTx };
      return { rx: 0, tx: 0 };
    }

    const deltaRx = totalRx - prevNetBytes.rx;
    const deltaTx = totalTx - prevNetBytes.tx;
    prevNetBytes = { rx: totalRx, tx: totalTx };

    return {
      rx: Math.max(deltaRx, 0),
      tx: Math.max(deltaTx, 0),
    };
  } catch {
    return { rx: 0, tx: 0 };
  }
}

export function collectSystemMetrics(): SystemMetricRow {
  const mem = getMemory();
  const disk = getDisk();
  const net = getNetwork();

  return {
    timestamp: Date.now(),
    cpu_percent: getCpuPercent(),
    mem_total: mem.total,
    mem_used: mem.used,
    mem_percent: mem.percent,
    disk_total: disk.total,
    disk_used: disk.used,
    disk_percent: disk.percent,
    net_rx_bytes: net.rx,
    net_tx_bytes: net.tx,
  };
}
