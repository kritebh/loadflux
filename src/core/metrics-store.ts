import type {
  DatabaseAdapter,
  ResolvedConfig,
  RequestRecord,
  DashboardSnapshot,
  SystemMetricRow,
  ProcessMetricRow,
  TopEndpointRow,
  StatusDistribution,
  OverviewMetrics,
} from "../types.js";
import { collectSystemMetrics } from "./system-collector.js";
import {
  collectProcessMetrics,
  startProcessMonitoring,
  stopProcessMonitoring,
} from "./process-collector.js";
import { Aggregator } from "./aggregator.js";

const SNAPSHOT_DB_CACHE_MS = 8000;
const SNAPSHOT_WARM_INTERVAL_MS = 5000;

interface SnapshotDbCache {
  fetchedAt: number;
  topByRequests: TopEndpointRow[];
  topByLatency: TopEndpointRow[];
  topByErrors: TopEndpointRow[];
  status: StatusDistribution;
  overview: Pick<OverviewMetrics, "avg_duration" | "p95_duration" | "p99_duration">;
}

export class MetricsStore {
  private aggregator: Aggregator;
  private systemTimer: ReturnType<typeof setInterval> | null = null;
  private snapshotWarmTimer: ReturnType<typeof setInterval> | null = null;
  private latestSystem: SystemMetricRow | null = null;
  private latestProcess: ProcessMetricRow | null = null;
  private readonly requestBuckets = new Uint32Array(60);
  private lastRequestSecond = -1;
  private totalRequests = 0;
  private totalErrors = 0;
  private snapshotDbCache: SnapshotDbCache | null = null;

  constructor(
    private db: DatabaseAdapter,
    private config: ResolvedConfig
  ) {
    this.aggregator = new Aggregator(db, config.collection.aggregationWindow);
  }

  start(): void {
    startProcessMonitoring();
    this.aggregator.start();

    const collectAndStore = () => {
      this.latestSystem = collectSystemMetrics();
      this.latestProcess = collectProcessMetrics();
      try {
        this.db.insertSystemAndProcessMetrics(
          this.latestSystem,
          this.latestProcess,
        );
      } catch (err) {
        console.error("[LoadFlux] Failed to insert system/process metrics:", err);
      }
    };

    collectAndStore();
    this.systemTimer = setInterval(
      collectAndStore,
      this.config.collection.systemInterval
    );
    this.systemTimer.unref();

    const warmSnapshotCache = () => {
      const now = Date.now();
      const hourRange = { from: now - 3_600_000, to: now };
      void this.getSnapshotDbData(hourRange).catch((err) => {
        console.error("[LoadFlux] Failed to warm snapshot cache:", err);
      });
    };
    warmSnapshotCache();
    this.snapshotWarmTimer = setInterval(warmSnapshotCache, SNAPSHOT_WARM_INTERVAL_MS);
    this.snapshotWarmTimer.unref();
  }

  stop(): void {
    if (this.systemTimer) {
      clearInterval(this.systemTimer);
      this.systemTimer = null;
    }
    if (this.snapshotWarmTimer) {
      clearInterval(this.snapshotWarmTimer);
      this.snapshotWarmTimer = null;
    }
    stopProcessMonitoring();
    this.aggregator.stop();
  }

  private advanceRequestBuckets(now: number): void {
    const sec = Math.floor(now / 1000);
    if (this.lastRequestSecond === -1) {
      this.lastRequestSecond = sec;
      return;
    }
    if (sec <= this.lastRequestSecond) return;

    const elapsed = sec - this.lastRequestSecond;
    if (elapsed >= 60) {
      this.requestBuckets.fill(0);
    } else {
      for (let s = this.lastRequestSecond + 1; s <= sec; s++) {
        this.requestBuckets[s % 60] = 0;
      }
    }
    this.lastRequestSecond = sec;
  }

  private getRpsRpm(now: number): { rps: number; rpm: number } {
    this.advanceRequestBuckets(now);
    const sec = Math.floor(now / 1000);
    let rpm = 0;
    for (let i = 0; i < 60; i++) {
      rpm += this.requestBuckets[i];
    }
    return { rps: this.requestBuckets[sec % 60], rpm };
  }

  recordRequest(entry: RequestRecord): void {
    this.aggregator.record(entry);
    this.totalRequests++;
    if (entry.statusCode >= 400) this.totalErrors++;

    const now = Date.now();
    this.advanceRequestBuckets(now);
    this.requestBuckets[Math.floor(now / 1000) % 60]++;
  }

  private async getSnapshotDbData(hourRange: { from: number; to: number }) {
    const now = Date.now();
    if (
      this.snapshotDbCache &&
      now - this.snapshotDbCache.fetchedAt < SNAPSHOT_DB_CACHE_MS
    ) {
      return this.snapshotDbCache;
    }

    const [
      topByRequests,
      topByLatency,
      topByErrors,
      status,
      overview,
    ] = await Promise.all([
      this.db.getTopEndpoints("request_count", 5, hourRange),
      this.db.getTopEndpoints("p95_duration", 5, hourRange),
      this.db.getTopEndpoints("error_rate", 5, hourRange),
      this.db.getStatusDistribution(hourRange),
      this.db.getOverview(hourRange),
    ]);

    this.snapshotDbCache = {
      fetchedAt: now,
      topByRequests,
      topByLatency,
      topByErrors,
      status,
      overview: {
        avg_duration: overview.avg_duration,
        p95_duration: overview.p95_duration,
        p99_duration: overview.p99_duration,
      },
    };
    return this.snapshotDbCache;
  }

  async getCurrentSnapshot(sseConnectionCount = 0): Promise<DashboardSnapshot> {
    const now = Date.now();
    const { rps, rpm } = this.getRpsRpm(now);

    const hourRange = { from: now - 3_600_000, to: now };

    let topByRequests: TopEndpointRow[] = [];
    let topByLatency: TopEndpointRow[] = [];
    let topByErrors: TopEndpointRow[] = [];
    let status: StatusDistribution = { status_2xx: 0, status_3xx: 0, status_4xx: 0, status_5xx: 0 };
    let overview = { avg_duration: 0, p95_duration: 0, p99_duration: 0 };

    try {
      const cached = await this.getSnapshotDbData(hourRange);
      topByRequests = cached.topByRequests;
      topByLatency = cached.topByLatency;
      topByErrors = cached.topByErrors;
      status = cached.status;
      overview = cached.overview;
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
