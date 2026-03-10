import { fetchSystemMetrics } from "../api/client";
import { useTimeRange, usePolledData } from "../hooks/useMetrics";
import { TimeRangeSelector } from "../components/TimeRangeSelector";
import { TimeSeriesChart } from "../components/charts/TimeSeriesChart";

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function System() {
  const { rangeMs, setRangeMs } = useTimeRange();
  const { data, loading } = usePolledData(fetchSystemMetrics, rangeMs);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Loading system metrics...
      </div>
    );
  }

  const metrics = data ?? [];
  const labels = metrics.map((m) => formatTime(m.timestamp));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold">System Metrics</h1>
        <TimeRangeSelector value={rangeMs} onChange={setRangeMs} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* CPU */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            CPU Usage
          </h3>
          <TimeSeriesChart
            labels={labels}
            datasets={[
              {
                label: "CPU %",
                data: metrics.map((m) => m.cpu_percent),
                color: "#3b82f6",
                fill: true,
              },
            ]}
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
            datasets={[
              {
                label: "Used",
                data: metrics.map((m) => m.mem_used / (1024 * 1024 * 1024)),
                color: "#8b5cf6",
                fill: true,
              },
              {
                label: "Total",
                data: metrics.map((m) => m.mem_total / (1024 * 1024 * 1024)),
                color: "#6b728080",
              },
            ]}
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
              datasets={[
                {
                  label: "Disk %",
                  data: metrics.map((m) => m.disk_percent ?? 0),
                  color: "#f59e0b",
                  fill: true,
                },
              ]}
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
                datasets={[
                  {
                    label: "RX",
                    data: metrics.map((m) => m.net_rx_bytes / 1024),
                    color: "#10b981",
                  },
                  {
                    label: "TX",
                    data: metrics.map((m) => m.net_tx_bytes / 1024),
                    color: "#ef4444",
                  },
                ]}
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
