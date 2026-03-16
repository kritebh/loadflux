import { useState, useCallback, useEffect } from "react";
import {
  fetchTopEndpoints,
  fetchEndpointMetricsPaginated,
  fetchSlowRequestsPaginated,
  type TopEndpointRow,
  type EndpointMetricRow,
  type PaginatedResponse,
} from "../api/client";
import { useTimeRange, usePolledData } from "../hooks/useMetrics";
import { TimeRangeSelector } from "../components/TimeRangeSelector";
import { BarChart } from "../components/charts/BarChart";
import { MetricsTable } from "../components/tables/MetricsTable";
import { Pagination } from "../components/Pagination";

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}us`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function usePaginatedPolledData<T>(
  fetcher: (
    from: number,
    to: number,
    page: number,
    limit: number,
  ) => Promise<PaginatedResponse<T>>,
  rangeMs: number,
  page: number,
  limit = 200,
  intervalMs = 10000,
) {
  const [data, setData] = useState<PaginatedResponse<T> | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const now = Date.now();
      const result = await fetcher(now - rangeMs, now, page, limit);
      setData(result);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AuthError") throw err;
    } finally {
      setLoading(false);
    }
  }, [fetcher, rangeMs, page, limit]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  return { data, loading, refresh };
}

export function Endpoints() {
  const { rangeMs, setRangeMs } = useTimeRange();
  const [topMetric, setTopMetric] = useState<string>("request_count");
  const [endpointsPage, setEndpointsPage] = useState(1);
  const [endpointsLimit, setEndpointsLimit] = useState(200);
  const [slowPage, setSlowPage] = useState(1);
  const [slowLimit, setSlowLimit] = useState(20);

  // Reset pages when time range changes
  useEffect(() => {
    setEndpointsPage(1);
    setSlowPage(1);
  }, [rangeMs]);

  const handleEndpointsLimitChange = useCallback((newLimit: number) => {
    setEndpointsLimit(newLimit);
    setEndpointsPage(1);
  }, []);

  const handleSlowLimitChange = useCallback((newLimit: number) => {
    setSlowLimit(newLimit);
    setSlowPage(1);
  }, []);

  const topFetcher = useCallback(
    (from: number, to: number) => fetchTopEndpoints(topMetric, from, to),
    [topMetric],
  );
  const { data: topData } = usePolledData<TopEndpointRow[]>(
    topFetcher,
    rangeMs,
  );

  const { data: endpointsPaginated } = usePaginatedPolledData(
    fetchEndpointMetricsPaginated,
    rangeMs,
    endpointsPage,
    endpointsLimit,
  );

  const { data: slowPaginated } = usePaginatedPolledData(
    fetchSlowRequestsPaginated,
    rangeMs,
    slowPage,
    slowLimit,
  );

  const top = topData ?? [];
  const endpoints = endpointsPaginated?.data ?? [];
  const slow = slowPaginated?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold">Endpoints</h1>
        <TimeRangeSelector value={rangeMs} onChange={setRangeMs} />
      </div>

      {/* Top endpoints chart */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Top Endpoints
          </h3>
          <select
            value={topMetric}
            onChange={(e) => setTopMetric(e.target.value)}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 outline-none"
          >
            <option value="request_count">By Request Count</option>
            <option value="avg_duration">By Avg Duration</option>
            <option value="p95_duration">By P95 Duration</option>
            <option value="error_rate">By Error Rate</option>
            <option value="total_res_bytes">By Response Size</option>
          </select>
        </div>
        {top.length > 0 ? (
          <BarChart
            labels={top.map((t) => `${t.method} ${t.path}`)}
            data={top.map((t) => t.value)}
            label={topMetric.replace(/_/g, " ")}
            horizontal
            height={Math.max(200, top.length * 35)}
          />
        ) : (
          <div className="flex items-center justify-center h-48 text-gray-400">
            No endpoint data yet
          </div>
        )}
      </div>

      {/* Slow requests */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
          Slow Requests
        </h3>
        <MetricsTable<EndpointMetricRow>
          columns={[
            {
              key: "Time",
              header: "Time",
              render: (r) => formatDate(r.timestamp),
            },
            { key: "method", header: "Method" },
            { key: "path", header: "Path" },
            {
              key: "avg_duration",
              header: "Avg",
              align: "right",
              render: (r) => formatDuration(r.avg_duration),
            },
            {
              key: "p95_duration",
              header: "P95",
              align: "right",
              render: (r) => formatDuration(r.p95_duration),
            },
            {
              key: "max_duration",
              header: "Max",
              align: "right",
              render: (r) => formatDuration(r.max_duration),
            },
            {
              key: "request_count",
              header: "Requests",
              align: "right",
              render: (r) => r.request_count.toLocaleString(),
            },
          ]}
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

      {/* All endpoints table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
          All Endpoints
        </h3>
        <MetricsTable<EndpointMetricRow>
          columns={[
            {
              key: "Time",
              header: "Time",
              render: (r) => formatDate(r.timestamp),
            },
            { key: "method", header: "Method" },
            { key: "path", header: "Path" },
            {
              key: "request_count",
              header: "Requests",
              align: "right",
              render: (r) => r.request_count.toLocaleString(),
            },
            {
              key: "error_count",
              header: "Errors",
              align: "right",
              render: (r) => (
                <span className={r.error_count > 0 ? "text-red-500" : ""}>
                  {r.error_count}
                </span>
              ),
            },
            {
              key: "total_duration",
              header: "Total Duration",
              align: "right",
              render: (r) => formatDuration(r.total_duration),
            },
            {
              key: "total_res_bytes",
              header: "Res Bytes",
              align: "right",
              render: (r) => r.total_res_bytes.toLocaleString(),
            },
            {
              key: "avg_duration",
              header: "Avg",
              align: "right",
              render: (r) => formatDuration(r.avg_duration),
            },
            {
              key: "p50_duration",
              header: "P50",
              align: "right",
              render: (r) => formatDuration(r.p50_duration),
            },
            {
              key: "p95_duration",
              header: "P95",
              align: "right",
              render: (r) => formatDuration(r.p95_duration),
            },
            {
              key: "p99_duration",
              header: "P99",
              align: "right",
              render: (r) => formatDuration(r.p99_duration),
            },
            {
              key: "status",
              header: "2xx/3xx/4xx/5xx",
              align: "right",
              render: (r) =>
                `${r.status_2xx}/${r.status_3xx}/${r.status_4xx}/${r.status_5xx}`,
            },
          ]}
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
