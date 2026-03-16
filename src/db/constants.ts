import type {
  OverviewMetrics,
  PaginatedResult,
  PaginationParams,
  StatusDistribution,
  TimeRange,
} from "../types.js";

// Shared collection / table names for all database adapters
export const TABLE_SYSTEM_METRICS = "loadflux_system_metrics";
export const TABLE_PROCESS_METRICS = "loadflux_process_metrics";
export const TABLE_ENDPOINT_METRICS = "loadflux_endpoint_metrics";
export const TABLE_ERROR_LOG = "loadflux_error_log";
export const TABLE_SETTINGS = "loadflux_settings";
export const TABLE_AUTH = "loadflux_auth";

export const SCHEMA_VERSION_KEY = "schema_version";

// Shared fallbacks and helpers
export const EMPTY_STATUS_DISTRIBUTION: StatusDistribution = {
  status_2xx: 0,
  status_3xx: 0,
  status_4xx: 0,
  status_5xx: 0,
};

export const EMPTY_OVERVIEW_BASE: Omit<OverviewMetrics, "rps" | "rpm"> = {
  total_requests: 0,
  total_errors: 0,
  error_rate: 0,
  avg_duration: 0,
  p95_duration: 0,
  p99_duration: 0,
};

export function buildPaginatedResult<T>(
  data: T[],
  total: number,
  pagination: PaginationParams,
): PaginatedResult<T> {
  const totalPages = Math.max(Math.ceil(total / pagination.limit), 1);
  return {
    data,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages,
      hasNext: pagination.page < totalPages,
      hasPrev: pagination.page > 1,
    },
  };
}

export function withRpsRpm<T extends { total_requests: number }>(
  range: TimeRange,
  base: T,
): T & Pick<OverviewMetrics, "rps" | "rpm"> {
  const spanSeconds = Math.max((range.to - range.from) / 1000, 1);
  const spanMinutes = Math.max(spanSeconds / 60, 1);

  return {
    ...base,
    rps: base.total_requests / spanSeconds,
    rpm: base.total_requests / spanMinutes,
  };
}

