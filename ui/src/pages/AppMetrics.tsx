import { fetchProcessMetrics } from "../api/client";
import { useTimeRange, usePolledData } from "../hooks/useMetrics";
import { useSSE } from "../hooks/useSSE";
import { TimeRangeSelector } from "../components/TimeRangeSelector";
import { TimeSeriesChart } from "../components/charts/TimeSeriesChart";
import { StatCard } from "../components/cards/StatCard";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

export function AppMetrics() {
  const { rangeMs, setRangeMs } = useTimeRange();
  const { data, loading } = usePolledData(fetchProcessMetrics, rangeMs);
  const { snapshot } = useSSE();

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Loading process metrics...
      </div>
    );
  }

  const metrics = data ?? [];
  const labels = metrics.map((m) => formatTime(m.timestamp));
  const latest = metrics[metrics.length - 1];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold">App Metrics</h1>
        <TimeRangeSelector value={rangeMs} onChange={setRangeMs} />
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
            value={formatUptime(snapshot?.process.uptime_seconds ?? latest.uptime_seconds)}
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
            datasets={[
              {
                label: "Heap Used",
                data: metrics.map((m) => m.heap_used / (1024 * 1024)),
                color: "#06b6d4",
                fill: true,
              },
              {
                label: "Heap Total",
                data: metrics.map((m) => m.heap_total / (1024 * 1024)),
                color: "#6b728080",
              },
            ]}
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
            datasets={[
              {
                label: "Avg",
                data: metrics.map((m) => m.event_loop_avg_ms),
                color: "#10b981",
              },
              {
                label: "Max",
                data: metrics.map((m) => m.event_loop_max_ms),
                color: "#ef4444",
              },
            ]}
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
            datasets={[
              {
                label: "GC Pause",
                data: metrics.map((m) => m.gc_pause_ms),
                color: "#f59e0b",
                fill: true,
              },
            ]}
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
            datasets={[
              {
                label: "External",
                data: metrics.map((m) => m.external_mem / (1024 * 1024)),
                color: "#8b5cf6",
                fill: true,
              },
            ]}
            yLabel="MB"
          />
        </div>
      </div>
    </div>
  );
}
