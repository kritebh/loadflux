import { useMemo } from "react";
import { fetchSystemMetrics } from "../api/client";
import { useTimeRange, usePolledData } from "../hooks/useMetrics";
import { TimeRangeSelector } from "../components/TimeRangeSelector";
import { TimeSeriesChart } from "../components/charts/TimeSeriesChart";
import { formatBytes, formatTimeLabel } from "../utils/format";

const MAX_CHART_POINTS = 280;

export function System() {
  const {
    range,
    rangeSyncToken,
    getRange,
    setCustomRange,
    resetToDefault,
    isDefaultLastHour,
  } = useTimeRange();
  const { data, loading } = usePolledData(
    (from, to) => fetchSystemMetrics(from, to, MAX_CHART_POINTS),
    getRange,
  );

  const metrics = data ?? [];
  const rangeMs = range.to - range.from;
  const chartMetrics = metrics;
  const labels = useMemo(
    () => chartMetrics.map((m) => formatTimeLabel(m.timestamp, rangeMs)),
    [chartMetrics, rangeMs],
  );

  const cpuData = useMemo(
    () => chartMetrics.map((m) => m.cpu_percent),
    [chartMetrics],
  );
  const memUsedData = useMemo(
    () => chartMetrics.map((m) => m.mem_used / (1024 * 1024 * 1024)),
    [chartMetrics],
  );
  const memTotalData = useMemo(
    () => chartMetrics.map((m) => m.mem_total / (1024 * 1024 * 1024)),
    [chartMetrics],
  );
  const diskData = useMemo(
    () => chartMetrics.map((m) => m.disk_percent ?? 0),
    [chartMetrics],
  );
  const netRxData = useMemo(
    () => chartMetrics.map((m) => m.net_rx_bytes / 1024),
    [chartMetrics],
  );
  const netTxData = useMemo(
    () => chartMetrics.map((m) => m.net_tx_bytes / 1024),
    [chartMetrics],
  );

  const cpuDatasets = useMemo(
    () => [{ label: "CPU %", data: cpuData, color: "#3b82f6", fill: true }],
    [cpuData],
  );
  const memDatasets = useMemo(
    () => [
      { label: "Used", data: memUsedData, color: "#8b5cf6", fill: true },
      { label: "Total", data: memTotalData, color: "#6b728080" },
    ],
    [memUsedData, memTotalData],
  );
  const diskDatasets = useMemo(
    () => [{ label: "Disk %", data: diskData, color: "#f59e0b", fill: true }],
    [diskData],
  );
  const netDatasets = useMemo(
    () => [
      { label: "RX", data: netRxData, color: "#10b981" },
      { label: "TX", data: netTxData, color: "#ef4444" },
    ],
    [netRxData, netTxData],
  );

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Loading system metrics...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="text-2xl font-bold">System Metrics</h1>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* CPU */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            CPU Usage
          </h3>
          <TimeSeriesChart
            labels={labels}
            datasets={cpuDatasets}
            yLabel="%"
            yMax={100}
          />
        </div>

        {/* Memory */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Memory Usage
          </h3>
          <TimeSeriesChart
            labels={labels}
            datasets={memDatasets}
            yLabel="GB"
          />
        </div>

        {/* Disk */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Disk Usage
          </h3>
          {metrics.some((m) => m.disk_percent !== null) ? (
            <TimeSeriesChart
              labels={labels}
              datasets={diskDatasets}
              yLabel="%"
              yMax={100}
            />
          ) : (
            <div className="flex items-center justify-center h-[250px] text-gray-400">
              Disk metrics not available
            </div>
          )}
        </div>

        {/* Network */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Network I/O
          </h3>
          {metrics.some((m) => m.net_rx_bytes > 0 || m.net_tx_bytes > 0) ? (
            <>
              <TimeSeriesChart
                labels={labels}
                datasets={netDatasets}
                yLabel="KB"
              />
              <div className="mt-2 flex justify-between text-xs text-gray-400">
                <span>
                  Latest RX: {formatBytes(metrics[metrics.length - 1]?.net_rx_bytes ?? 0)}
                </span>
                <span>
                  Latest TX: {formatBytes(metrics[metrics.length - 1]?.net_tx_bytes ?? 0)}
                </span>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-[250px] text-gray-400">
              Network metrics available on Linux only
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
