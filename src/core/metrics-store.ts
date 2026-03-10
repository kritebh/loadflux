import type {
  DatabaseAdapter,
  ResolvedConfig,
  RequestRecord,
  DashboardSnapshot,
  SystemMetricRow,
  ProcessMetricRow,
  TopEndpointRow,
  StatusDistribution,
} from "../types.js";
import { collectSystemMetrics } from "./system-collector.js";
import {
  collectProcessMetrics,
  startProcessMonitoring,
  stopProcessMonitoring,
} from "./process-collector.js";
import { Aggregator } from "./aggregator.js";

export class MetricsStore {
  private aggregator: Aggregator;
  private systemTimer: ReturnType<typeof setInterval> | null = null;
  private latestSystem: SystemMetricRow | null = null;
  private latestProcess: ProcessMetricRow | null = null;
  // Rolling counters for RPS/RPM
  private recentRequests: number[] = []; // timestamps of recent requests
  private totalRequests = 0;
  private totalErrors = 0;

  constructor(
    private db: DatabaseAdapter,
    private config: ResolvedConfig
  ) {
    this.aggregator = new Aggregator(db, config.collection.aggregationWindow);
  }

  start(): void {
    startProcessMonitoring();
    this.aggregator.start();

    // Collect system + process metrics on interval
    const collectAndStore = () => {
      this.latestSystem = collectSystemMetrics();
      this.latestProcess = collectProcessMetrics();
      try {
        this.db.insertSystemMetrics(this.latestSystem);
        this.db.insertProcessMetrics(this.latestProcess);
      } catch (err) {
        console.error("[LoadFlux] Failed to insert system/process metrics:", err);
      }
    };

    // First collection immediately
    collectAndStore();
    this.systemTimer = setInterval(
      collectAndStore,
      this.config.collection.systemInterval
    );
    this.systemTimer.unref();
  }

  stop(): void {
    if (this.systemTimer) {
      clearInterval(this.systemTimer);
      this.systemTimer = null;
    }
    stopProcessMonitoring();
    this.aggregator.stop();
  }

  recordRequest(entry: RequestRecord): void {
    this.aggregator.record(entry);
    this.totalRequests++;
    if (entry.statusCode >= 400) this.totalErrors++;

    const now = Date.now();
    this.recentRequests.push(now);
    // Keep only last 60 seconds of timestamps for RPM calculation
    const cutoff = now - 60_000;
    while (this.recentRequests.length > 0 && this.recentRequests[0] < cutoff) {
      this.recentRequests.shift();
    }
  }

  async getCurrentSnapshot(sseConnectionCount = 0): Promise<DashboardSnapshot> {
    const now = Date.now();
    const oneSecAgo = now - 1000;
    const rps = this.recentRequests.filter((t) => t >= oneSecAgo).length;
    const rpm = this.recentRequests.length;

    const hourRange = { from: now - 3_600_000, to: now };

    let topByRequests: TopEndpointRow[] = [];
    let topByLatency: TopEndpointRow[] = [];
    let topByErrors: TopEndpointRow[] = [];
    let status: StatusDistribution = { status_2xx: 0, status_3xx: 0, status_4xx: 0, status_5xx: 0 };
    let overview = { avg_duration: 0, p95_duration: 0, p99_duration: 0 };

    try {
      [topByRequests, topByLatency, topByErrors, status, overview] =
        await Promise.all([
          this.db.getTopEndpoints("request_count", 5, hourRange),
          this.db.getTopEndpoints("p95_duration", 5, hourRange),
          this.db.getTopEndpoints("error_rate", 5, hourRange),
          this.db.getStatusDistribution(hourRange),
          this.db.getOverview(hourRange),
        ]);
    } catch (err) {
      console.error("[LoadFlux] Failed to query snapshot data:", err);
    }

    return {
      system: {
        cpu_percent: this.latestSystem?.cpu_percent ?? 0,
        mem_percent: this.latestSystem?.mem_percent ?? 0,
        mem_used: this.latestSystem?.mem_used ?? 0,
        mem_total: this.latestSystem?.mem_total ?? 0,
        disk_percent: this.latestSystem?.disk_percent ?? null,
        net_rx_bytes: this.latestSystem?.net_rx_bytes ?? 0,
        net_tx_bytes: this.latestSystem?.net_tx_bytes ?? 0,
      },
      process: {
        heap_used: this.latestProcess?.heap_used ?? 0,
        heap_total: this.latestProcess?.heap_total ?? 0,
        event_loop_avg_ms: this.latestProcess?.event_loop_avg_ms ?? 0,
        event_loop_max_ms: this.latestProcess?.event_loop_max_ms ?? 0,
        gc_pause_ms: this.latestProcess?.gc_pause_ms ?? 0,
        uptime_seconds: this.latestProcess?.uptime_seconds ?? 0,
      },
      overview: {
        rps,
        rpm,
        total_requests: this.totalRequests,
        error_rate:
          this.totalRequests > 0
            ? Math.round(
                (this.totalErrors / this.totalRequests) * 100 * 100
              ) / 100
            : 0,
        avg_duration: overview.avg_duration,
        p95_duration: overview.p95_duration,
        p99_duration: overview.p99_duration,
      },
      endpoints: {
        top_by_requests: topByRequests,
        top_by_latency: topByLatency,
        top_by_errors: topByErrors,
        status,
      },
      server: {
        node_version: process.version,
        platform: process.platform,
        pid: process.pid,
        sse_connections: sseConnectionCount,
      },
      timestamp: now,
    };
  }
}
