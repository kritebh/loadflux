import { memo, useCallback, useMemo, useState } from "react";
import { fetchTopEndpoints, type TopEndpointRow } from "../../api/client";
import { usePolledData, type TimeRangeValue } from "../../hooks/useMetrics";
import { BarChart } from "../charts/BarChart";
import { ChartLoadingOverlay } from "../ChartLoadingOverlay";

interface Props {
  getRange: () => TimeRangeValue;
  debouncedSearch: string;
}

export const TopEndpointsPanel = memo(function TopEndpointsPanel({
  getRange,
  debouncedSearch,
}: Props) {
  const [topMetric, setTopMetric] = useState("request_count");

  const topFetcher = useCallback(
    (from: number, to: number) =>
      fetchTopEndpoints(topMetric, from, to, 10, debouncedSearch),
    [topMetric, debouncedSearch],
  );

  const { data: topData, loading, refreshing } = usePolledData<TopEndpointRow[]>(
    topFetcher,
    getRange,
    10000,
    [topMetric, debouncedSearch],
  );

  const top = topData ?? [];

  const barLabels = useMemo(
    () => top.map((t) => `${t.method} ${t.path}`),
    [top],
  );
  const barValues = useMemo(() => top.map((t) => t.value), [top]);
  const chartLabel = useMemo(() => topMetric.replace(/_/g, " "), [topMetric]);
  const chartHeight = useMemo(() => Math.max(200, top.length * 35), [top.length]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
          Top Endpoints
        </h3>
        <select
          value={topMetric}
          onChange={(e) => setTopMetric(e.target.value)}
          disabled={refreshing}
          className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 outline-none disabled:opacity-60"
        >
          <option value="request_count">By Request Count</option>
          <option value="avg_duration">By Avg Duration</option>
          <option value="p95_duration">By P95 Duration</option>
          <option value="error_rate">By Error Rate</option>
          <option value="total_res_bytes">By Response Size</option>
        </select>
      </div>
      <div className="relative min-h-[12rem]">
        {(loading || refreshing) && <ChartLoadingOverlay />}
        {top.length > 0 ? (
          <BarChart
            labels={barLabels}
            data={barValues}
            label={chartLabel}
            horizontal
            height={chartHeight}
          />
        ) : !loading ? (
          <div className="flex items-center justify-center h-48 text-gray-400">
            No endpoint data yet
          </div>
        ) : null}
      </div>
    </div>
  );
});
