import { useMemo, useState } from "react";
import { fetchProcessMetrics } from "../api/client";
import { useTimeRange, usePolledData } from "../hooks/useMetrics";
import { TimeRangeSelector } from "../components/TimeRangeSelector";
import { InstanceSelector } from "../components/InstanceSelector";
import { TimeSeriesChart } from "../components/charts/TimeSeriesChart";
import { StatCard } from "../components/cards/StatCard";
import { formatBytes, formatTimeLabel, formatUptime } from "../utils/format";

const MAX_CHART_POINTS = 280;

export function AppMetrics() {
  const [selectedInstance, setSelectedInstance] = useState("");
  const {
    range,
    rangeSyncToken,
    getRange,
    setCustomRange,
    resetToDefault,
    isDefaultLastHour,
  } = useTimeRange();
  const { data, loading } = usePolledData(
    (from, to) =>
      fetchProcessMetrics(
        from,
        to,
        MAX_CHART_POINTS,
        selectedInstance || undefined,
      ),
    getRange,
    10000,
    [selectedInstance],
  );
  const metrics = data ?? [];
  const rangeMs = range.to - range.from;

  const chartData = useMemo(() => {
    const labels: string[] = [];
    const heapUsedData: number[] = [];
    const heapTotalData: number[] = [];
    const eventLoopAvgData: number[] = [];
    const eventLoopMaxData: number[] = [];
    const gcPauseData: number[] = [];
    const externalMemData: number[] = [];

    for (const m of metrics) {
      labels.push(formatTimeLabel(m.timestamp, rangeMs));
      heapUsedData.push(m.heap_used / (1024 * 1024));
      heapTotalData.push(m.heap_total / (1024 * 1024));
      eventLoopAvgData.push(m.event_loop_avg_ms);
      eventLoopMaxData.push(m.event_loop_max_ms);
      gcPauseData.push(m.gc_pause_ms);
      externalMemData.push(m.external_mem / (1024 * 1024));
    }

    return {
      labels,
      heapUsedData,
      heapTotalData,
      eventLoopAvgData,
      eventLoopMaxData,
      gcPauseData,
      externalMemData,
    };
  }, [metrics, rangeMs]);

  const latest = metrics[metrics.length - 1];

  const heapDatasets = useMemo(
    () => [
      { label: "Heap Used", data: chartData.heapUsedData, color: "#06b6d4", fill: true },
      { label: "Heap Total", data: chartData.heapTotalData, color: "#6b728080" },
    ],
    [chartData.heapUsedData, chartData.heapTotalData],
  );
  const eventLoopDatasets = useMemo(
    () => [
      { label: "Avg", data: chartData.eventLoopAvgData, color: "#10b981" },
      { label: "Max", data: chartData.eventLoopMaxData, color: "#ef4444" },
    ],
    [chartData.eventLoopAvgData, chartData.eventLoopMaxData],
  );
  const gcDatasets = useMemo(
    () => [{ label: "GC Pause", data: chartData.gcPauseData, color: "#f59e0b", fill: true }],
    [chartData.gcPauseData],
  );
  const externalDatasets = useMemo(
    () => [{ label: "External", data: chartData.externalMemData, color: "#8b5cf6", fill: true }],
    [chartData.externalMemData],
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
        <div className="flex flex-col gap-2 shrink-0 sm:ml-auto sm:items-end">
          <InstanceSelector
            getRange={getRange}
            rangeSyncToken={rangeSyncToken}
            value={selectedInstance}
            onChange={setSelectedInstance}
          />
          <TimeRangeSelector
            range={range}
            rangeSyncToken={rangeSyncToken}
            isDefaultLastHour={isDefaultLastHour}
            onApply={setCustomRange}
            onResetDefault={resetToDefault}
          />
        </div>
      </div>

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
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Heap Usage
          </h3>
          <TimeSeriesChart
            labels={chartData.labels}
            datasets={heapDatasets}
            yLabel="MB"
          />
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Event Loop Delay
          </h3>
          <TimeSeriesChart
            labels={chartData.labels}
            datasets={eventLoopDatasets}
            yLabel="ms"
          />
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            GC Pause Time
          </h3>
          <TimeSeriesChart
            labels={chartData.labels}
            datasets={gcDatasets}
            yLabel="ms"
          />
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            External Memory
          </h3>
          <TimeSeriesChart
            labels={chartData.labels}
            datasets={externalDatasets}
            yLabel="MB"
          />
        </div>
      </div>
    </div>
  );
}
