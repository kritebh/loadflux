import { useMemo, useState } from "react";
import { fetchSystemMetrics } from "../api/client";
import { useTimeRange, usePolledData } from "../hooks/useMetrics";
import { TimeRangeSelector } from "../components/TimeRangeSelector";
import { InstanceSelector } from "../components/InstanceSelector";
import { TimeSeriesChart } from "../components/charts/TimeSeriesChart";
import { formatBytes, formatTimeLabel } from "../utils/format";

const MAX_CHART_POINTS = 280;

export function System() {
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
      fetchSystemMetrics(
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
    const cpuData: number[] = [];
    const memUsedData: number[] = [];
    const memTotalData: number[] = [];
    const diskData: number[] = [];
    const netRxData: number[] = [];
    const netTxData: number[] = [];
    let hasDisk = false;
    let hasNetwork = false;

    for (const m of metrics) {
      labels.push(formatTimeLabel(m.timestamp, rangeMs));
      cpuData.push(m.cpu_percent);
      memUsedData.push(m.mem_used / (1024 * 1024 * 1024));
      memTotalData.push(m.mem_total / (1024 * 1024 * 1024));
      diskData.push(m.disk_percent ?? 0);
      netRxData.push(m.net_rx_bytes / 1024);
      netTxData.push(m.net_tx_bytes / 1024);
      if (m.disk_percent !== null) hasDisk = true;
      if (m.net_rx_bytes > 0 || m.net_tx_bytes > 0) hasNetwork = true;
    }

    return {
      labels,
      cpuData,
      memUsedData,
      memTotalData,
      diskData,
      netRxData,
      netTxData,
      hasDisk,
      hasNetwork,
    };
  }, [metrics, rangeMs]);

  const cpuDatasets = useMemo(
    () => [{ label: "CPU %", data: chartData.cpuData, color: "#3b82f6", fill: true }],
    [chartData.cpuData],
  );
  const memDatasets = useMemo(
    () => [
      { label: "Used", data: chartData.memUsedData, color: "#8b5cf6", fill: true },
      { label: "Total", data: chartData.memTotalData, color: "#6b728080" },
    ],
    [chartData.memUsedData, chartData.memTotalData],
  );
  const diskDatasets = useMemo(
    () => [{ label: "Disk %", data: chartData.diskData, color: "#f59e0b", fill: true }],
    [chartData.diskData],
  );
  const netDatasets = useMemo(
    () => [
      { label: "RX", data: chartData.netRxData, color: "#10b981" },
      { label: "TX", data: chartData.netTxData, color: "#ef4444" },
    ],
    [chartData.netRxData, chartData.netTxData],
  );

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Loading system metrics...
      </div>
    );
  }

  const latest = metrics[metrics.length - 1];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="text-2xl font-bold">System Metrics</h1>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            CPU Usage
          </h3>
          <TimeSeriesChart
            labels={chartData.labels}
            datasets={cpuDatasets}
            yLabel="%"
            yMax={100}
          />
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Memory Usage
          </h3>
          <TimeSeriesChart
            labels={chartData.labels}
            datasets={memDatasets}
            yLabel="GB"
          />
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Disk Usage
          </h3>
          {chartData.hasDisk ? (
            <TimeSeriesChart
              labels={chartData.labels}
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

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Network I/O
          </h3>
          {chartData.hasNetwork ? (
            <>
              <TimeSeriesChart
                labels={chartData.labels}
                datasets={netDatasets}
                yLabel="KB"
              />
              <div className="mt-2 flex justify-between text-xs text-gray-400">
                <span>
                  Latest RX: {formatBytes(latest?.net_rx_bytes ?? 0)}
                </span>
                <span>
                  Latest TX: {formatBytes(latest?.net_tx_bytes ?? 0)}
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
