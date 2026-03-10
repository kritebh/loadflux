import { useSSE } from "../hooks/useSSE";
import { StatCard } from "../components/cards/StatCard";
import { GaugeChart } from "../components/charts/GaugeChart";
import { MetricsTable } from "../components/tables/MetricsTable";
import type { TopEndpointRow } from "../api/client";

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
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}us`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function Dashboard() {
  const { snapshot } = useSSE();

  if (!snapshot) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Waiting for data...
      </div>
    );
  }

  const { system, process: proc, overview, endpoints, server } = snapshot;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {/* Live stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Requests / sec"
          value={overview.rps.toFixed(2)}
          subtitle="Live"
          color="blue"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          }
        />
        <StatCard
          title="Requests / min"
          value={overview.rpm.toFixed(1)}
          subtitle="Live"
          color="cyan"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          title="Total Requests"
          value={overview.total_requests.toLocaleString()}
          subtitle={`Since start (${formatUptime(proc.uptime_seconds)})`}
          color="emerald"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          }
        />
        <StatCard
          title="Error Rate"
          value={`${overview.error_rate.toFixed(2)}%`}
          subtitle={`Since start (${formatUptime(proc.uptime_seconds)})`}
          color={overview.error_rate > 5 ? "red" : overview.error_rate > 1 ? "amber" : "emerald"}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          }
        />
      </div>

      {/* Gauges */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 flex justify-center">
          <GaugeChart value={system.cpu_percent} label="CPU Usage" />
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 flex justify-center">
          <GaugeChart value={system.mem_percent} label="Memory Usage" />
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 flex justify-center">
          <GaugeChart
            value={system.disk_percent ?? 0}
            label="Disk Usage"
            suffix={system.disk_percent !== null ? "%" : ""}
          />
        </div>
      </div>

      {/* Response time + status breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          title="Avg Response Time"
          value={formatDuration(overview.avg_duration)}
          subtitle="Last 1h"
          color={overview.avg_duration > 500 ? "red" : overview.avg_duration > 200 ? "amber" : "emerald"}
        />
        <StatCard
          title="P95 Response Time"
          value={formatDuration(overview.p95_duration)}
          subtitle="Last 1h"
          color={overview.p95_duration > 1000 ? "red" : overview.p95_duration > 500 ? "amber" : "emerald"}
        />
        <StatCard
          title="P99 Response Time"
          value={formatDuration(overview.p99_duration)}
          subtitle="Last 1h"
          color={overview.p99_duration > 2000 ? "red" : overview.p99_duration > 1000 ? "amber" : "emerald"}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="2xx Responses"
          value={endpoints.status.status_2xx.toLocaleString()}
          subtitle="Last 1h"
          color="emerald"
        />
        <StatCard
          title="4xx Errors"
          value={endpoints.status.status_4xx.toLocaleString()}
          subtitle="Last 1h"
          color="amber"
        />
        <StatCard
          title="5xx Errors"
          value={endpoints.status.status_5xx.toLocaleString()}
          subtitle="Last 1h"
          color="red"
        />
      </div>

      {/* Top endpoints tables */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">
            Top Endpoints (1h)
          </h3>
          <MetricsTable<TopEndpointRow>
            columns={[
              {
                key: "endpoint",
                header: "Endpoint",
                render: (r) => (
                  <span className="font-mono text-xs">
                    <span className="text-blue-500 font-semibold">{r.method}</span>{" "}
                    {r.path}
                  </span>
                ),
              },
              {
                key: "value",
                header: "Reqs",
                align: "right",
                render: (r) => r.value.toLocaleString(),
              },
            ]}
            data={endpoints.top_by_requests}
            keyExtractor={(r) => `${r.method}:${r.path}`}
            emptyMessage="No traffic yet"
          />
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">
            Slowest Endpoints - P95 (1h)
          </h3>
          <MetricsTable<TopEndpointRow>
            columns={[
              {
                key: "endpoint",
                header: "Endpoint",
                render: (r) => (
                  <span className="font-mono text-xs">
                    <span className="text-blue-500 font-semibold">{r.method}</span>{" "}
                    {r.path}
                  </span>
                ),
              },
              {
                key: "value",
                header: "P95",
                align: "right",
                render: (r) => formatDuration(r.value),
              },
            ]}
            data={endpoints.top_by_latency}
            keyExtractor={(r) => `${r.method}:${r.path}`}
            emptyMessage="No traffic yet"
          />
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">
            Highest Error Rate (1h)
          </h3>
          <MetricsTable<TopEndpointRow>
            columns={[
              {
                key: "endpoint",
                header: "Endpoint",
                render: (r) => (
                  <span className="font-mono text-xs">
                    <span className="text-blue-500 font-semibold">{r.method}</span>{" "}
                    {r.path}
                  </span>
                ),
              },
              {
                key: "value",
                header: "Err %",
                align: "right",
                render: (r) => (
                  <span className={r.value > 0 ? "text-red-500" : ""}>
                    {r.value.toFixed(1)}%
                  </span>
                ),
              },
            ]}
            data={endpoints.top_by_errors}
            keyExtractor={(r) => `${r.method}:${r.path}`}
            emptyMessage="No errors"
          />
        </div>
      </div>

      {/* Process info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Heap Used"
          value={formatBytes(proc.heap_used)}
          subtitle={`of ${formatBytes(proc.heap_total)}`}
          color="cyan"
        />
        <StatCard
          title="Event Loop Avg"
          value={`${proc.event_loop_avg_ms.toFixed(2)} ms`}
          color={proc.event_loop_avg_ms > 100 ? "red" : proc.event_loop_avg_ms > 20 ? "amber" : "emerald"}
        />
        <StatCard
          title="Network RX"
          value={formatBytes(system.net_rx_bytes)}
          subtitle={`TX: ${formatBytes(system.net_tx_bytes)}`}
          color="blue"
        />
        <StatCard
          title="Uptime"
          value={formatUptime(proc.uptime_seconds)}
          color="emerald"
        />
      </div>

      {/* Server info */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-5 py-3">
        <div className="flex items-center flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          <span>
            <span className="text-gray-400 dark:text-gray-500">Node</span>{" "}
            <span className="font-medium text-gray-700 dark:text-gray-300">{server.node_version}</span>
          </span>
          <span>
            <span className="text-gray-400 dark:text-gray-500">Platform</span>{" "}
            <span className="font-medium text-gray-700 dark:text-gray-300">{server.platform}</span>
          </span>
          <span>
            <span className="text-gray-400 dark:text-gray-500">PID</span>{" "}
            <span className="font-medium text-gray-700 dark:text-gray-300">{server.pid}</span>
          </span>
          <span>
            <span className="text-gray-400 dark:text-gray-500">SSE Connections</span>{" "}
            <span className="font-medium text-gray-700 dark:text-gray-300">{server.sse_connections}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
