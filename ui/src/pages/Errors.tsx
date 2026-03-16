import { useState, useCallback, useEffect } from "react";
import {
  fetchErrorsPaginated,
  fetchStatusDistribution,
  type ErrorLogRow,
  type PaginatedResponse,
} from "../api/client";
import { useTimeRange, usePolledData } from "../hooks/useMetrics";
import { TimeRangeSelector } from "../components/TimeRangeSelector";
import { DoughnutChart } from "../components/charts/DoughnutChart";
import { MetricsTable } from "../components/tables/MetricsTable";
import { StatCard } from "../components/cards/StatCard";
import { Pagination } from "../components/Pagination";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function usePaginatedPolledData<T>(
  fetcher: (from: number, to: number, page: number, limit: number) => Promise<PaginatedResponse<T>>,
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

export function Errors() {
  const { rangeMs, setRangeMs } = useTimeRange();
  const [errorPage, setErrorPage] = useState(1);
  const [errorLimit, setErrorLimit] = useState(200);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Reset page when time range changes
  useEffect(() => {
    setErrorPage(1);
  }, [rangeMs]);

  const handleErrorLimitChange = useCallback((newLimit: number) => {
    setErrorLimit(newLimit);
    setErrorPage(1);
  }, []);

  const { data: errorsPaginated } = usePaginatedPolledData(
    fetchErrorsPaginated,
    rangeMs,
    errorPage,
    errorLimit,
  );
  const { data: distribution } = usePolledData(fetchStatusDistribution, rangeMs);

  const errorList = errorsPaginated?.data ?? [];
  const totalErrors = errorsPaginated?.pagination?.total ?? 0;
  const dist = distribution ?? { status_2xx: 0, status_3xx: 0, status_4xx: 0, status_5xx: 0 };
  const total = dist.status_2xx + dist.status_3xx + dist.status_4xx + dist.status_5xx;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold">Errors</h1>
        <TimeRangeSelector value={rangeMs} onChange={setRangeMs} />
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Errors"
          value={totalErrors.toLocaleString()}
          color="red"
        />
        <StatCard
          title="4xx Errors"
          value={dist.status_4xx.toLocaleString()}
          color="amber"
        />
        <StatCard
          title="5xx Errors"
          value={dist.status_5xx.toLocaleString()}
          color="red"
        />
        <StatCard
          title="Error Rate"
          value={total > 0 ? `${(((dist.status_4xx + dist.status_5xx) / total) * 100).toFixed(2)}%` : "0%"}
          color={dist.status_5xx > 0 ? "red" : "emerald"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Status distribution */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Status Distribution
          </h3>
          {total > 0 ? (
            <DoughnutChart
              labels={["2xx", "3xx", "4xx", "5xx"]}
              data={[dist.status_2xx, dist.status_3xx, dist.status_4xx, dist.status_5xx]}
              colors={["#10b981", "#3b82f6", "#f59e0b", "#ef4444"]}
            />
          ) : (
            <div className="flex items-center justify-center h-[250px] text-gray-400">
              No request data
            </div>
          )}
        </div>

        {/* Error log table */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Error Log
          </h3>
          <MetricsTable<ErrorLogRow>
            columns={[
              {
                key: "timestamp",
                header: "Time",
                render: (r) => formatTime(r.timestamp),
              },
              { key: "method", header: "Method" },
              { key: "path", header: "Path" },
              {
                key: "status_code",
                header: "Status",
                align: "center",
                render: (r) => (
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      r.status_code >= 500
                        ? "bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400"
                        : "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400"
                    }`}
                  >
                    {r.status_code}
                  </span>
                ),
              },
              {
                key: "duration_ms",
                header: "Duration",
                align: "right",
                render: (r) => `${r.duration_ms.toFixed(1)}ms`,
              },
              {
                key: "error_msg",
                header: "Message",
                render: (r) => (
                  <button
                    onClick={() =>
                      setExpandedId(expandedId === r.timestamp ? null : r.timestamp)
                    }
                    className="text-left max-w-xs truncate text-blue-500 hover:underline"
                    title={r.error_msg ?? ""}
                  >
                    {r.error_msg || "-"}
                  </button>
                ),
              },
            ]}
            data={errorList}
            keyExtractor={(r, i) => `${r.timestamp}:${r.path}:${i}`}
            emptyMessage="No errors recorded"
          />

          {/* Expanded stack trace */}
          {expandedId !== null && (
            <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
              <h4 className="text-sm font-medium mb-2">Stack Trace</h4>
              <pre className="text-xs text-gray-600 dark:text-gray-400 overflow-x-auto whitespace-pre-wrap">
                {errorList.find((e) => e.timestamp === expandedId)?.stack_trace ||
                  "No stack trace available"}
              </pre>
            </div>
          )}

          {errorsPaginated?.pagination && (
            <Pagination
              page={errorsPaginated.pagination.page}
              totalPages={errorsPaginated.pagination.totalPages}
              total={errorsPaginated.pagination.total}
              limit={errorLimit}
              onPageChange={setErrorPage}
              onLimitChange={handleErrorLimitChange}
            />
          )}
        </div>
      </div>
    </div>
  );
}
