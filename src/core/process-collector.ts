import { PerformanceObserver, monitorEventLoopDelay } from "perf_hooks";
import type { ProcessMetricRow } from "../types.js";

// GC pause tracking
let gcTotalPauseMs = 0;
let gcObserver: PerformanceObserver | null = null;

// Event loop delay monitoring
let elHistogram: ReturnType<typeof monitorEventLoopDelay> | null = null;

export function startProcessMonitoring(): void {
  // GC pause observer
  try {
    gcObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        gcTotalPauseMs += entry.duration;
      }
    });
    gcObserver.observe({ entryTypes: ["gc"] });
  } catch {
    // GC observation not available — gcTotalPauseMs stays at 0
  }

  // Event loop delay histogram
  try {
    elHistogram = monitorEventLoopDelay({ resolution: 20 });
    elHistogram.enable();
  } catch {
    // monitorEventLoopDelay not available
  }
}

export function stopProcessMonitoring(): void {
  gcObserver?.disconnect();
  gcObserver = null;
  elHistogram?.disable();
  elHistogram = null;
}

export function collectProcessMetrics(): ProcessMetricRow {
  const mem = process.memoryUsage();

  // Event loop delay (nanoseconds -> milliseconds)
  // mean/max return NaN before any samples are collected — default to 0
  let elAvg = 0;
  let elMax = 0;
  if (elHistogram) {
    const mean = elHistogram.mean;
    const max = elHistogram.max;
    elAvg = Number.isFinite(mean) ? mean / 1e6 : 0;
    elMax = Number.isFinite(max) ? max / 1e6 : 0;
    elHistogram.reset();
  }

  // Capture and reset GC pause accumulator
  const gcPause = gcTotalPauseMs;
  gcTotalPauseMs = 0;

  return {
    timestamp: Date.now(),
    heap_used: mem.heapUsed,
    heap_total: mem.heapTotal,
    external_mem: mem.external,
    event_loop_avg_ms: Math.round(elAvg * 100) / 100,
    event_loop_max_ms: Math.round(elMax * 100) / 100,
    gc_pause_ms: Math.round(gcPause * 100) / 100,
    uptime_seconds: Math.round(process.uptime() * 100) / 100,
  };
}
