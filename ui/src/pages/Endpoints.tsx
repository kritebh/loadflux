import { useState, useCallback } from "react";
import {
  fetchTopEndpoints,
  fetchSlowRequests,
  fetchEndpointMetrics,
  type TopEndpointRow,
  type EndpointMetricRow,
} from "../api/client";
import { useTimeRange, usePolledData } from "../hooks/useMetrics";
import { TimeRangeSelector } from "../components/TimeRangeSelector";
import { BarChart } from "../components/charts/BarChart";
import { MetricsTable } from "../components/tables/MetricsTable";

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}us`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function Endpoints() {
  const { rangeMs, setRangeMs } = useTimeRange();
  const [topMetric, setTopMetric] = useState<string>("request_count");

  const topFetcher = useCallback(
    (from: number, to: number) => fetchTopEndpoints(topMetric, from, to),
    [topMetric]
  );
  const { data: topData } = usePolledData<TopEndpointRow[]>(topFetcher, rangeMs);
  const { data: slowData } = usePolledData(fetchSlowRequests, rangeMs);
  const { data: allEndpoints } = usePolledData(fetchEndpointMetrics, rangeMs);

  const top = topData ?? [];
  const slow = slowData ?? [];
  const endpoints = allEndpoints ?? [];

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
          data={slow.slice(0, 20)}
          keyExtractor={(r, i) => `${r.method}:${r.path}:${i}`}
          emptyMessage="No slow requests"
        />
      </div>

      {/* All endpoints table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
          All Endpoints
        </h3>
        <MetricsTable<EndpointMetricRow>
          columns={[
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
      </div>
    </div>
  );
}
