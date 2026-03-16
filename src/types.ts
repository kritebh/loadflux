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

export interface SystemMetricRow {
  id?: number;
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

  // Queries (async to support both sync SQLite and async MongoDB)
  getSystemMetrics(range: TimeRange): Promise<SystemMetricRow[]>;
  getProcessMetrics(range: TimeRange): Promise<ProcessMetricRow[]>;
  getEndpointMetrics(range: TimeRange): Promise<EndpointMetricRow[]>;
  getTopEndpoints(
    metric: TopEndpointMetric,
    limit: number,
    range: TimeRange
  ): Promise<TopEndpointRow[]>;
  getSlowRequests(
    thresholdMs: number,
    range: TimeRange
  ): Promise<EndpointMetricRow[]>;
  getErrorLog(range: TimeRange): Promise<ErrorLogRow[]>;
  getStatusDistribution(range: TimeRange): Promise<StatusDistribution>;
  getOverview(range: TimeRange): Promise<OverviewMetrics>;

  // Paginated queries
  getSystemMetricsPaginated(
    range: TimeRange,
    pagination: PaginationParams
  ): Promise<PaginatedResult<SystemMetricRow>>;
  getProcessMetricsPaginated(
    range: TimeRange,
    pagination: PaginationParams
  ): Promise<PaginatedResult<ProcessMetricRow>>;
  getEndpointMetricsPaginated(
    range: TimeRange,
    pagination: PaginationParams
  ): Promise<PaginatedResult<EndpointMetricRow>>;
  getSlowRequestsPaginated(
    thresholdMs: number,
    range: TimeRange,
    pagination: PaginationParams
  ): Promise<PaginatedResult<EndpointMetricRow>>;
  getErrorLogPaginated(
    range: TimeRange,
    pagination: PaginationParams
  ): Promise<PaginatedResult<ErrorLogRow>>;

  // Maintenance
  deleteOlderThan(timestamp: number): void;

  // Settings (async for MongoDB compat)
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): void;

  // Auth (async for MongoDB compat)
  getUser(
    username: string
  ): Promise<{ username: string; password_hash: string } | null>;
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
  };
  timestamp: number;
}
