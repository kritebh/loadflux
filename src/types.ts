// ─── Configuration ───────────────────────────────────────────────────────────

export interface LoadFluxConfig {
  /** Dashboard path (default: "/loadflux") */
  path?: string;

  /** Framework: auto-detected if not specified */
  framework?: "express" | "fastify";

  /** Database configuration */
  database?: {
    adapter?: "sqlite" | "mongodb";
    /** SQLite: path to .db file (default: "./loadflux.db"), MongoDB: connection string */
    connectionString?: string;
  };

  /** Authentication (optional at init, can be set via dashboard) */
  auth?: {
    username: string;
    password: string;
  };

  /** Metrics collection intervals */
  collection?: {
    /** System metrics collection interval in ms (default: 5000) */
    systemInterval?: number;
    /** Aggregation window in ms (default: 5000) */
    aggregationWindow?: number;
  };

  /** Data retention */
  retention?: {
    /** Days to keep metrics (default: 90) */
    days?: number;
    /** Cron expression for cleanup (default: "0 2 * * *" = 2 AM daily) */
    cronExpression?: string;
  };

  /** Requests slower than this threshold in ms are flagged (default: 500) */
  slowRequestThreshold?: number;

  /** Routes to exclude from monitoring (e.g., ["/health"]) */
  excludeRoutes?: string[];

  disableOnLocalhost?: boolean;

  listenHost?: string;

  trustProxy?: boolean;

  /** Multi-instance / cluster aggregation (requires MongoDB for multiple writers). */
  cluster?: {
    /** Enable cluster-wide live and historical aggregation. */
    enabled?: boolean;
    /** Per-container ID; defaults to LOADFLUX_INSTANCE_ID, HOSTNAME, or os.hostname(). */
    instanceId?: string;
  };
}

export interface ResolvedConfig {
  path: string;
  framework: "express" | "fastify";
  database: {
    adapter: "sqlite" | "mongodb";
    connectionString: string;
  };
  auth: { username: string; password: string } | null;
  collection: {
    systemInterval: number;
    aggregationWindow: number;
  };
  retention: {
    days: number;
    cronExpression: string;
  };
  slowRequestThreshold: number;
  excludeRoutes: string[];
  disableOnLocalhost: boolean;
  listenHost: string | null;
  trustProxy: boolean;
  cluster: {
    enabled: boolean;
    instanceId: string;
  };
}

// ─── Request Record (raw, in-memory before aggregation) ─────────────────────

export interface RequestRecord {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  responseBytes: number;
  timestamp: number;
  errorMessage?: string;
  stackTrace?: string;
}

// ─── Database Rows ──────────────────────────────────────────────────────────

export interface MetricsQueryOptions {
  /** Filter to a single instance; omit for all instances. */
  instanceId?: string;
  /** Aggregate metrics across all instances (cluster view). */
  clusterAggregate?: boolean;
}

export interface LiveOverviewMetrics {
  rps: number;
  rpm: number;
  total_requests: number;
  total_errors: number;
  error_rate: number;
}

export interface LifetimeTotals {
  total_requests: number;
  total_errors: number;
}

export interface SystemMetricRow {
  id?: number;
  instance_id?: string;
  timestamp: number;
  cpu_percent: number;
  mem_total: number;
  mem_used: number;
  mem_percent: number;
  disk_total: number | null;
  disk_used: number | null;
  disk_percent: number | null;
  net_rx_bytes: number;
  net_tx_bytes: number;
}

export interface ProcessMetricRow {
  id?: number;
  instance_id?: string;
  timestamp: number;
  heap_used: number;
  heap_total: number;
  external_mem: number;
  event_loop_avg_ms: number;
  event_loop_max_ms: number;
  gc_pause_ms: number;
  uptime_seconds: number;
}

export interface EndpointMetricRow {
  id?: number;
  instance_id?: string;
  timestamp: number;
  method: string;
  path: string;
  request_count: number;
  error_count: number;
  total_duration: number;
  min_duration: number;
  max_duration: number;
  avg_duration: number;
  p50_duration: number;
  p90_duration: number;
  p95_duration: number;
  p99_duration: number;
  total_res_bytes: number;
  status_2xx: number;
  status_3xx: number;
  status_4xx: number;
  status_5xx: number;
}

export interface ErrorLogRow {
  id?: number;
  instance_id?: string;
  timestamp: number;
  method: string;
  path: string;
  status_code: number;
  error_msg: string | null;
  stack_trace: string | null;
  duration_ms: number;
}

// ─── Pagination ─────────────────────────────────────────────────────────────

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// ─── Query types ────────────────────────────────────────────────────────────

export interface TimeRange {
  from: number;
  to: number;
}

export interface QueryFilter {
  search?: string;
  status?: string;
}

export type TopEndpointMetric =
  | "request_count"
  | "avg_duration"
  | "p95_duration"
  | "error_rate"
  | "total_res_bytes";

export interface TopEndpointRow {
  method: string;
  path: string;
  value: number;
}

export interface StatusDistribution {
  status_2xx: number;
  status_3xx: number;
  status_4xx: number;
  status_5xx: number;
}

export interface OverviewMetrics {
  total_requests: number;
  total_errors: number;
  error_rate: number;
  avg_duration: number;
  p95_duration: number;
  p99_duration: number;
  rps: number;
  rpm: number;
}

// ─── Database Adapter ───────────────────────────────────────────────────────

export interface DatabaseAdapter {
  connect(): Promise<void>;
  close(): Promise<void>;

  // Inserts (fire-and-forget for both adapters)
  insertSystemMetrics(metrics: SystemMetricRow): void;
  insertProcessMetrics(metrics: ProcessMetricRow): void;
  insertEndpointMetricsBatch(rows: EndpointMetricRow[]): void;
  insertError(error: ErrorLogRow): void;
  insertErrorsBatch(errors: ErrorLogRow[]): void;
  insertSystemAndProcessMetrics(
    system: SystemMetricRow,
    process: ProcessMetricRow,
  ): void;

  // Queries (async to support both sync SQLite and async MongoDB)
  getSystemMetrics(
    range: TimeRange,
    maxPoints?: number,
    options?: MetricsQueryOptions,
  ): Promise<SystemMetricRow[]>;
  getProcessMetrics(
    range: TimeRange,
    maxPoints?: number,
    options?: MetricsQueryOptions,
  ): Promise<ProcessMetricRow[]>;
  getLiveOverview(now: number): Promise<LiveOverviewMetrics>;
  /** O(1) lifetime counters for the live dashboard (not reduced by retention). */
  getLifetimeTotals(): Promise<LifetimeTotals>;
  /** Increment lifetime counters after an endpoint metrics flush. */
  incrementLifetimeTotals(requests: number, errors: number): void;
  getClusterSystemLive(lookbackMs: number): Promise<SystemMetricRow | null>;
  getClusterProcessLive(lookbackMs: number): Promise<ProcessMetricRow | null>;
  listInstances(range: TimeRange): Promise<string[]>;
  countInstances(range: TimeRange): Promise<number>;
  getEndpointMetrics(
    range: TimeRange,
    filter?: QueryFilter,
  ): Promise<EndpointMetricRow[]>;
  getTopEndpoints(
    metric: TopEndpointMetric,
    limit: number,
    range: TimeRange,
    filter?: QueryFilter,
  ): Promise<TopEndpointRow[]>;
  getSlowRequests(
    thresholdMs: number,
    range: TimeRange,
    filter?: QueryFilter,
  ): Promise<EndpointMetricRow[]>;
  getErrorLog(range: TimeRange, filter?: QueryFilter): Promise<ErrorLogRow[]>;
  /** Distinct HTTP status codes present in the error log for the time range (sorted ascending). */
  getErrorStatusCodes(range: TimeRange): Promise<number[]>;
  getStatusDistribution(range: TimeRange): Promise<StatusDistribution>;
  getOverview(range: TimeRange): Promise<OverviewMetrics>;

  // Paginated queries
  getSystemMetricsPaginated(
    range: TimeRange,
    pagination: PaginationParams,
    maxPoints?: number,
    options?: MetricsQueryOptions,
  ): Promise<PaginatedResult<SystemMetricRow>>;
  getProcessMetricsPaginated(
    range: TimeRange,
    pagination: PaginationParams,
    maxPoints?: number,
    options?: MetricsQueryOptions,
  ): Promise<PaginatedResult<ProcessMetricRow>>;
  getEndpointMetricsPaginated(
    range: TimeRange,
    pagination: PaginationParams,
    filter?: QueryFilter,
  ): Promise<PaginatedResult<EndpointMetricRow>>;
  getSlowRequestsPaginated(
    thresholdMs: number,
    range: TimeRange,
    pagination: PaginationParams,
    filter?: QueryFilter,
  ): Promise<PaginatedResult<EndpointMetricRow>>;
  getErrorLogPaginated(
    range: TimeRange,
    pagination: PaginationParams,
    filter?: QueryFilter,
  ): Promise<PaginatedResult<ErrorLogRow>>;

  // Maintenance
  deleteOlderThan(timestamp: number): void;

  // Settings (async for MongoDB compat)
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): void;

  // Auth (async for MongoDB compat)
  getUser(
    username: string,
  ): Promise<{ username: string; password_hash: string } | null>;
  /** True if at least one dashboard user exists (auth is configured). */
  hasAnyUser(): Promise<boolean>;
  createUser(username: string, passwordHash: string): void;
  updateUserPassword(username: string, passwordHash: string): void;
}

// ─── Auth ───────────────────────────────────────────────────────────────────

export interface AuthToken {
  username: string;
  iat: number;
  exp: number;
}

// ─── SSE / Dashboard Snapshot ───────────────────────────────────────────────

export interface DashboardSnapshot {
  system: {
    cpu_percent: number;
    mem_percent: number;
    mem_used: number;
    mem_total: number;
    disk_percent: number | null;
    net_rx_bytes: number;
    net_tx_bytes: number;
  };
  process: {
    heap_used: number;
    heap_total: number;
    event_loop_avg_ms: number;
    event_loop_max_ms: number;
    gc_pause_ms: number;
    uptime_seconds: number;
  };
  overview: {
    rps: number;
    rpm: number;
    total_requests: number;
    error_rate: number;
    avg_duration: number;
    p95_duration: number;
    p99_duration: number;
  };
  endpoints: {
    top_by_requests: TopEndpointRow[];
    top_by_latency: TopEndpointRow[];
    top_by_errors: TopEndpointRow[];
    status: StatusDistribution;
  };
  server: {
    node_version: string;
    platform: string;
    pid: number;
    sse_connections: number;
    instance_id?: string;
    cluster_instances?: number;
    cluster_enabled?: boolean;
  };
  timestamp: number;
}
