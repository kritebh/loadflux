import type { ProcessMetricRow, SystemMetricRow } from "../types.js";

export function aggregateSystemRows(rows: SystemMetricRow[]): SystemMetricRow {
  if (rows.length === 0) {
    return {
      timestamp: Date.now(),
      cpu_percent: 0,
      mem_total: 0,
      mem_used: 0,
      mem_percent: 0,
      disk_total: null,
      disk_used: null,
      disk_percent: null,
      net_rx_bytes: 0,
      net_tx_bytes: 0,
    };
  }

  let cpuSum = 0;
  let memUsed = 0;
  let memTotal = 0;
  let diskPercentSum = 0;
  let diskPercentCount = 0;
  let netRx = 0;
  let netTx = 0;
  let latestTs = 0;

  for (const row of rows) {
    cpuSum += row.cpu_percent;
    memUsed += row.mem_used;
    memTotal = Math.max(memTotal, row.mem_total);
    netRx += row.net_rx_bytes;
    netTx += row.net_tx_bytes;
    latestTs = Math.max(latestTs, row.timestamp);
    if (row.disk_percent !== null) {
      diskPercentSum += row.disk_percent;
      diskPercentCount++;
    }
  }

  const count = rows.length;
  const diskPercent =
    diskPercentCount > 0 ? diskPercentSum / diskPercentCount : null;

  return {
    timestamp: latestTs,
    cpu_percent: Math.round((cpuSum / count) * 100) / 100,
    mem_total: memTotal,
    mem_used: memUsed,
    mem_percent:
      memTotal > 0
        ? Math.round((memUsed / memTotal) * 100 * 100) / 100
        : 0,
    disk_total: null,
    disk_used: null,
    disk_percent: diskPercent,
    net_rx_bytes: netRx,
    net_tx_bytes: netTx,
  };
}

export function aggregateProcessRows(
  rows: ProcessMetricRow[],
): ProcessMetricRow {
  if (rows.length === 0) {
    return {
      timestamp: Date.now(),
      heap_used: 0,
      heap_total: 0,
      external_mem: 0,
      event_loop_avg_ms: 0,
      event_loop_max_ms: 0,
      gc_pause_ms: 0,
      uptime_seconds: 0,
    };
  }

  let heapUsed = 0;
  let heapTotal = 0;
  let externalMem = 0;
  let eventLoopAvgSum = 0;
  let eventLoopMax = 0;
  let gcPauseSum = 0;
  let uptimeMax = 0;
  let latestTs = 0;

  for (const row of rows) {
    heapUsed += row.heap_used;
    heapTotal += row.heap_total;
    externalMem += row.external_mem;
    eventLoopAvgSum += row.event_loop_avg_ms;
    eventLoopMax = Math.max(eventLoopMax, row.event_loop_max_ms);
    gcPauseSum += row.gc_pause_ms;
    uptimeMax = Math.max(uptimeMax, row.uptime_seconds);
    latestTs = Math.max(latestTs, row.timestamp);
  }

  const count = rows.length;
  return {
    timestamp: latestTs,
    heap_used: heapUsed,
    heap_total: heapTotal,
    external_mem: externalMem,
    event_loop_avg_ms: Math.round((eventLoopAvgSum / count) * 100) / 100,
    event_loop_max_ms: eventLoopMax,
    gc_pause_ms: Math.round((gcPauseSum / count) * 100) / 100,
    uptime_seconds: uptimeMax,
  };
}
