import type {
  RequestRecord,
  EndpointMetricRow,
  ErrorLogRow,
  DatabaseAdapter,
} from "../types.js";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(idx, 0)];
}

export class Aggregator {
  private buffer = new Map<string, RequestRecord[]>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private db: DatabaseAdapter,
    private windowMs: number
  ) {}

  start(): void {
    this.flushTimer = setInterval(() => this.flush(), this.windowMs);
    // Allow the timer to not prevent process exit
    this.flushTimer.unref();
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Final flush
    this.flush();
  }

  record(entry: RequestRecord): void {
    const key = `${entry.method}:${entry.path}`;
    let records = this.buffer.get(key);
    if (!records) {
      records = [];
      this.buffer.set(key, records);
    }
    records.push(entry);
  }

  private flush(): void {
    // Swap buffer atomically — new requests go into fresh map
    const snapshot = this.buffer;
    this.buffer = new Map();

    if (snapshot.size === 0) return;

    const timestamp = Date.now();
    const endpointRows: EndpointMetricRow[] = [];
    const errors: ErrorLogRow[] = [];

    for (const [key, records] of snapshot) {
      const colonIdx = key.indexOf(":");
      const method = key.substring(0, colonIdx);
      const path = key.substring(colonIdx + 1);

      const durations = records
        .map((r) => r.durationMs)
        .sort((a, b) => a - b);
      const totalDuration = durations.reduce((a, b) => a + b, 0);

      let s2xx = 0,
        s3xx = 0,
        s4xx = 0,
        s5xx = 0,
        errCount = 0;
      for (const r of records) {
        const code = r.statusCode;
        if (code >= 200 && code < 300) s2xx++;
        else if (code >= 300 && code < 400) s3xx++;
        else if (code >= 400 && code < 500) {
          s4xx++;
          errCount++;
        } else if (code >= 500) {
          s5xx++;
          errCount++;
        }
      }

      endpointRows.push({
        timestamp,
        method,
        path,
        request_count: records.length,
        error_count: errCount,
        total_duration: totalDuration,
        min_duration: durations[0],
        max_duration: durations[durations.length - 1],
        avg_duration:
          Math.round((totalDuration / records.length) * 100) / 100,
        p50_duration: percentile(durations, 50),
        p90_duration: percentile(durations, 90),
        p95_duration: percentile(durations, 95),
        p99_duration: percentile(durations, 99),
        total_res_bytes: records.reduce((a, r) => a + r.responseBytes, 0),
        status_2xx: s2xx,
        status_3xx: s3xx,
        status_4xx: s4xx,
        status_5xx: s5xx,
      });

      // Collect individual errors for the error_log table
      for (const r of records) {
        if (r.statusCode >= 400) {
          errors.push({
            timestamp: r.timestamp,
            method: r.method,
            path: r.path,
            status_code: r.statusCode,
            error_msg: r.errorMessage ?? null,
            stack_trace: r.stackTrace ?? null,
            duration_ms: r.durationMs,
          });
        }
      }
    }

    // Batch insert (for SQLite: single transaction, for MongoDB: insertMany)
    try {
      this.db.insertEndpointMetricsBatch(endpointRows);
    } catch (err) {
      console.error("[LoadFlux] Failed to insert endpoint metrics batch:", err);
    }

    for (const e of errors) {
      try {
        this.db.insertError(e);
      } catch (err) {
        console.error("[LoadFlux] Failed to insert error log:", err);
      }
    }
  }
}
