export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}us`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatTimeLabel(ts: number, rangeMs: number): string {
  const d = new Date(ts);
  const DAY = 24 * 60 * 60 * 1000;
  if (rangeMs <= DAY) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (rangeMs <= 7 * DAY) {
    return (
      d.toLocaleDateString([], { month: "short", day: "numeric" }) +
      " " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatTime(ts: number): string {
  return formatDate(ts);
}

export function formatUptime(
  seconds: number,
  options?: { showSeconds?: boolean },
): string {
  const showSeconds = options?.showSeconds ?? false;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) {
    return showSeconds ? `${h}h ${m}m ${s}s` : `${h}h ${m}m`;
  }
  return showSeconds ? `${m}m ${s}s` : `${m}m`;
}

/**
 * Subtitle for lifetime counters (Total Requests / Error Rate). These counters
 * are never reduced by retention cleanup, so retention is deliberately not
 * mentioned here.
 */
export function formatLifetimeMetricsSubtitle(
  monitoringSinceMs: number | null,
  oldestEndpointMetricMs?: number | null,
): string {
  const sinceMs = monitoringSinceMs ?? oldestEndpointMetricMs;
  if (sinceMs == null) {
    return "Lifetime (no history yet)";
  }
  const since = new Date(sinceMs).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `Lifetime · since ${since}`;
}

/** Requests/sec with 2 decimals; tiny non-zero rates show as "<0.01" rather than "0.00". */
export function formatRate(rps: number): string {
  if (rps > 0 && rps < 0.01) return "<0.01";
  return rps.toFixed(2);
}
