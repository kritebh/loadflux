import { useState, useCallback, useEffect } from "react";
import {
  fetchEndpointMetricsPaginated,
  fetchSlowRequestsPaginated,
  type EndpointMetricRow,
} from "../api/client";
import { useTimeRange, usePaginatedPolledData } from "../hooks/useMetrics";
import { TimeRangeSelector } from "../components/TimeRangeSelector";
import { MetricsTable } from "../components/tables/MetricsTable";
import { Pagination } from "../components/Pagination";
import { DebouncedSearchInput } from "../components/DebouncedSearchInput";
import { TopEndpointsPanel } from "../components/endpoints/TopEndpointsPanel";
import { formatDate, formatDuration } from "../utils/format";

const slowColumns = [
  {
    key: "Time",
    header: "Time",
    render: (r: EndpointMetricRow) => formatDate(r.timestamp),
  },
  { key: "method", header: "Method" },
  { key: "path", header: "Path" },
  {
    key: "avg_duration",
    header: "Avg",
    align: "right" as const,
    render: (r: EndpointMetricRow) => formatDuration(r.avg_duration),
  },
  {
    key: "p95_duration",
    header: "P95",
    align: "right" as const,
    render: (r: EndpointMetricRow) => formatDuration(r.p95_duration),
  },
  {
    key: "max_duration",
    header: "Max",
    align: "right" as const,
    render: (r: EndpointMetricRow) => formatDuration(r.max_duration),
  },
  {
    key: "request_count",
    header: "Requests",
    align: "right" as const,
    render: (r: EndpointMetricRow) => r.request_count.toLocaleString(),
  },
];

const allEndpointsColumns = [
  {
    key: "Time",
    header: "Time",
    render: (r: EndpointMetricRow) => formatDate(r.timestamp),
  },
  { key: "method", header: "Method" },
  { key: "path", header: "Path" },
  {
    key: "request_count",
    header: "Requests",
    align: "right" as const,
    render: (r: EndpointMetricRow) => r.request_count.toLocaleString(),
  },
  {
    key: "error_count",
    header: "Errors",
    align: "right" as const,
    render: (r: EndpointMetricRow) => (
      <span className={r.error_count > 0 ? "text-red-500" : ""}>
        {r.error_count}
      </span>
    ),
  },
  {
    key: "total_duration",
    header: "Total Duration",
    align: "right" as const,
    render: (r: EndpointMetricRow) => formatDuration(r.total_duration),
  },
  {
    key: "total_res_bytes",
    header: "Res Bytes",
    align: "right" as const,
    render: (r: EndpointMetricRow) => r.total_res_bytes.toLocaleString(),
  },
  {
    key: "avg_duration",
    header: "Avg",
    align: "right" as const,
    render: (r: EndpointMetricRow) => formatDuration(r.avg_duration),
  },
  {
    key: "p50_duration",
    header: "P50",
    align: "right" as const,
    render: (r: EndpointMetricRow) => formatDuration(r.p50_duration),
  },
  {
    key: "p95_duration",
    header: "P95",
    align: "right" as const,
    render: (r: EndpointMetricRow) => formatDuration(r.p95_duration),
  },
  {
    key: "p99_duration",
    header: "P99",
    align: "right" as const,
    render: (r: EndpointMetricRow) => formatDuration(r.p99_duration),
  },
  {
    key: "status",
    header: "2xx/3xx/4xx/5xx",
    align: "right" as const,
    render: (r: EndpointMetricRow) =>
      `${r.status_2xx}/${r.status_3xx}/${r.status_4xx}/${r.status_5xx}`,
  },
];

export function Endpoints() {
  const {
    range,
    rangeSyncToken,
    getRange,
    setCustomRange,
    resetToDefault,
    isDefaultLastHour,
  } = useTimeRange();
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [endpointsPage, setEndpointsPage] = useState(1);
  const [endpointsLimit, setEndpointsLimit] = useState(200);
  const [slowPage, setSlowPage] = useState(1);
  const [slowLimit, setSlowLimit] = useState(20);

  const handleDebouncedSearch = useCallback((value: string) => {
    setDebouncedSearch(value);
  }, []);

  useEffect(() => {
    setEndpointsPage(1);
    setSlowPage(1);
  }, [rangeSyncToken, debouncedSearch]);

  const handleEndpointsLimitChange = useCallback((newLimit: number) => {
    setEndpointsLimit(newLimit);
    setEndpointsPage(1);
  }, []);

  const handleSlowLimitChange = useCallback((newLimit: number) => {
    setSlowLimit(newLimit);
    setSlowPage(1);
  }, []);

  const paginatedEndpointFetcher = useCallback(
    (from: number, to: number, page: number, limit: number) =>
      fetchEndpointMetricsPaginated(from, to, page, limit, debouncedSearch),
    [debouncedSearch],
  );

  const { data: endpointsPaginated } = usePaginatedPolledData(
    paginatedEndpointFetcher,
    getRange,
    endpointsPage,
    endpointsLimit,
    10000,
    [debouncedSearch],
    { initialDelayMs: 150 },
  );

  const paginatedSlowFetcher = useCallback(
    (from: number, to: number, page: number, limit: number) =>
      fetchSlowRequestsPaginated(from, to, page, limit, undefined, debouncedSearch),
    [debouncedSearch],
  );

  const { data: slowPaginated } = usePaginatedPolledData(
    paginatedSlowFetcher,
    getRange,
    slowPage,
    slowLimit,
    10000,
    [debouncedSearch],
    { initialDelayMs: 300 },
  );

  const endpoints = endpointsPaginated?.data ?? [];
  const slow = slowPaginated?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Endpoints</h1>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <DebouncedSearchInput
            onDebouncedChange={handleDebouncedSearch}
            ariaLabel="Search endpoints"
          />
          <div className="shrink-0 sm:ml-auto">
            <TimeRangeSelector
              range={range}
              rangeSyncToken={rangeSyncToken}
              isDefaultLastHour={isDefaultLastHour}
              onApply={setCustomRange}
              onResetDefault={resetToDefault}
            />
          </div>
        </div>
      </div>

      <TopEndpointsPanel getRange={getRange} debouncedSearch={debouncedSearch} />

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
          Slow Requests
        </h3>
        <MetricsTable<EndpointMetricRow>
          columns={slowColumns}
          data={slow}
          keyExtractor={(r, i) => `${r.method}:${r.path}:${i}`}
          emptyMessage="No slow requests"
        />
        {slowPaginated?.pagination && (
          <Pagination
            page={slowPaginated.pagination.page}
            totalPages={slowPaginated.pagination.totalPages}
            total={slowPaginated.pagination.total}
            limit={slowLimit}
            onPageChange={setSlowPage}
            onLimitChange={handleSlowLimitChange}
          />
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
          All Endpoints
        </h3>
        <MetricsTable<EndpointMetricRow>
          columns={allEndpointsColumns}
          data={endpoints}
          keyExtractor={(r, i) => `${r.method}:${r.path}:${r.timestamp}:${i}`}
          emptyMessage="No endpoint data yet"
        />
        {endpointsPaginated?.pagination && (
          <Pagination
            page={endpointsPaginated.pagination.page}
            totalPages={endpointsPaginated.pagination.totalPages}
            total={endpointsPaginated.pagination.total}
            limit={endpointsLimit}
            onPageChange={setEndpointsPage}
            onLimitChange={handleEndpointsLimitChange}
          />
        )}
      </div>
    </div>
  );
}
