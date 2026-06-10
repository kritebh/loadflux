import { useState, useCallback, useEffect } from "react";
import {
  fetchErrorStatusCodes,
  fetchErrorsPaginated,
  fetchStatusDistribution,
  type ErrorLogRow,
} from "../api/client";
import { useTimeRange, usePolledData, usePaginatedPolledData } from "../hooks/useMetrics";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { TimeRangeSelector } from "../components/TimeRangeSelector";
import { DoughnutChart } from "../components/charts/DoughnutChart";
import { MetricsTable } from "../components/tables/MetricsTable";
import { StatCard } from "../components/cards/StatCard";
import { Pagination } from "../components/Pagination";
import { IconChevronDown, IconFilter, IconSearch } from "../components/icons";
import { formatTime } from "../utils/format";

export function Errors() {
  const {
    range,
    rangeSyncToken,
    getRange,
    setCustomRange,
    resetToDefault,
    isDefaultLastHour,
  } = useTimeRange();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [statusFilter, setStatusFilter] = useState("all");
  const [errorPage, setErrorPage] = useState(1);
  const [errorLimit, setErrorLimit] = useState(200);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: statusCodesData } = usePolledData(
    async (from, to) => {
      const { codes } = await fetchErrorStatusCodes(from, to);
      return Array.isArray(codes) ? codes : [];
    },
    getRange,
  );
  const statusCodes = statusCodesData ?? [];

  useEffect(() => {
    if (statusFilter === "all") return;
    const n = parseInt(statusFilter, 10);
    if (!Number.isFinite(n) || !statusCodes.includes(n)) {
      setStatusFilter("all");
    }
  }, [statusCodes, statusFilter]);

  // Reset page when time range changes
  useEffect(() => {
    setErrorPage(1);
  }, [rangeSyncToken, debouncedSearch, statusFilter]);

  const handleErrorLimitChange = useCallback((newLimit: number) => {
    setErrorLimit(newLimit);
    setErrorPage(1);
  }, []);

  const paginatedErrorFetcher = useCallback(
    (from: number, to: number, page: number, limit: number) =>
      fetchErrorsPaginated(from, to, page, limit, debouncedSearch, statusFilter),
    [debouncedSearch, statusFilter],
  );

  const { data: errorsPaginated } = usePaginatedPolledData(
    paginatedErrorFetcher,
    getRange,
    errorPage,
    errorLimit,
  );
  const { data: distribution } = usePolledData(fetchStatusDistribution, getRange);

  const errorList = errorsPaginated?.data ?? [];
  const totalErrors = errorsPaginated?.pagination?.total ?? 0;
  const dist = distribution ?? { status_2xx: 0, status_3xx: 0, status_4xx: 0, status_5xx: 0 };
  const total = dist.status_2xx + dist.status_3xx + dist.status_4xx + dist.status_5xx;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Errors</h1>
        <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-3">
          <div className="flex flex-1 flex-wrap items-center gap-2 min-w-0">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                aria-label="Search errors"
                className="w-full text-sm pl-9 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="relative shrink-0">
              <IconFilter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none z-[1]" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by HTTP status"
                title={
                  statusCodes.length === 0
                    ? "No error rows in this range — only “All statuses” applies"
                    : "Filter by response status"
                }
                className="text-sm pl-9 pr-8 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none appearance-none focus:ring-1 focus:ring-blue-500 min-w-[7.5rem] cursor-pointer"
              >
                <option value="all">All statuses</option>
                {statusCodes.map((code) => (
                  <option key={code} value={String(code)}>
                    {code}
                  </option>
                ))}
              </select>
              <IconChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            </div>
          </div>
          <div className="shrink-0 lg:ml-auto">
            <TimeRangeSelector
              range={range}
              rangeSyncToken={rangeSyncToken}
              isDefaultLastHour={isDefaultLastHour}
              onApply={setCustomRange}
              onResetDefault={resetToDefault}
            />
          </div>
        </div>
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
