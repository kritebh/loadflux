import { useMemo } from "react";
import { fetchProcessMetrics } from "../api/client";
import { useTimeRange, usePolledData } from "../hooks/useMetrics";
import { TimeRangeSelector } from "../components/TimeRangeSelector";
import { TimeSeriesChart } from "../components/charts/TimeSeriesChart";
import { StatCard } from "../components/cards/StatCard";
import { formatBytes, formatTimeLabel, formatUptime } from "../utils/format";

const MAX_CHART_POINTS = 280;

export function AppMetrics() {
  const {
    range,
    rangeSyncToken,
    getRange,
    setCustomRange,
    resetToDefault,
    isDefaultLastHour,
  } = useTimeRange();
  const { data, loading } = usePolledData(
    (from, to) => fetchProcessMetrics(from, to, MAX_CHART_POINTS),
    getRange,
  );
  const metrics = data ?? [];
  const rangeMs = range.to - range.from;
  const chartMetrics = metrics;
  const labels = useMemo(
    () => chartMetrics.map((m) => formatTimeLabel(m.timestamp, rangeMs)),
    [chartMetrics, rangeMs],
  );
  const latest = metrics[metrics.length - 1];

  const heapUsedData = useMemo(
    () => chartMetrics.map((m) => m.heap_used / (1024 * 1024)),
    [chartMetrics],
  );
  const heapTotalData = useMemo(
    () => chartMetrics.map((m) => m.heap_total / (1024 * 1024)),
    [chartMetrics],
  );
  const eventLoopAvgData = useMemo(
    () => chartMetrics.map((m) => m.event_loop_avg_ms),
    [chartMetrics],
  );
  const eventLoopMaxData = useMemo(
    () => chartMetrics.map((m) => m.event_loop_max_ms),
    [chartMetrics],
  );
  const gcPauseData = useMemo(
    () => chartMetrics.map((m) => m.gc_pause_ms),
    [chartMetrics],
  );
  const externalMemData = useMemo(
    () => chartMetrics.map((m) => m.external_mem / (1024 * 1024)),
    [chartMetrics],
  );

  const heapDatasets = useMemo(
    () => [
      { label: "Heap Used", data: heapUsedData, color: "#06b6d4", fill: true },
      { label: "Heap Total", data: heapTotalData, color: "#6b728080" },
    ],
    [heapUsedData, heapTotalData],
  );
  const eventLoopDatasets = useMemo(
    () => [
      { label: "Avg", data: eventLoopAvgData, color: "#10b981" },
      { label: "Max", data: eventLoopMaxData, color: "#ef4444" },
    ],
    [eventLoopAvgData, eventLoopMaxData],
  );
  const gcDatasets = useMemo(
    () => [{ label: "GC Pause", data: gcPauseData, color: "#f59e0b", fill: true }],
    [gcPauseData],
  );
  const externalDatasets = useMemo(
    () => [{ label: "External", data: externalMemData, color: "#8b5cf6", fill: true }],
    [externalMemData],
  );

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Loading process metrics...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="text-2xl font-bold">App Metrics</h1>
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

      {/* Summary cards */}
      {latest && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Heap Used"
            value={formatBytes(latest.heap_used)}
            subtitle={`of ${formatBytes(latest.heap_total)}`}
            color="cyan"
          />
          <StatCard
            title="External Memory"
            value={formatBytes(latest.external_mem)}
            color="blue"
          />
          <StatCard
            title="Event Loop Avg"
            value={`${latest.event_loop_avg_ms.toFixed(2)} ms`}
            color={latest.event_loop_avg_ms > 100 ? "red" : "emerald"}
          />
          <StatCard
            title="Uptime"
            value={formatUptime(latest.uptime_seconds, {
              showSeconds: true,
            })}
            color="emerald"
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Heap */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Heap Usage
          </h3>
          <TimeSeriesChart
            labels={labels}
            datasets={heapDatasets}
            yLabel="MB"
          />
        </div>

        {/* Event Loop */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Event Loop Delay
          </h3>
          <TimeSeriesChart
            labels={labels}
            datasets={eventLoopDatasets}
            yLabel="ms"
          />
        </div>

        {/* GC Pauses */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            GC Pause Time
          </h3>
          <TimeSeriesChart
            labels={labels}
            datasets={gcDatasets}
            yLabel="ms"
          />
        </div>

        {/* External Memory */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            External Memory
          </h3>
          <TimeSeriesChart
            labels={labels}
            datasets={externalDatasets}
            yLabel="MB"
          />
        </div>
      </div>
    </div>
  );
}
