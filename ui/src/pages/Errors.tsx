import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  createContext,
  useContext,
} from "react";
import {
  fetchErrorStatusCodes,
  fetchErrorsPaginated,
  fetchStatusDistribution,
  type ErrorLogRow,
} from "../api/client";
import { useTimeRange, usePolledData, usePaginatedPolledData } from "../hooks/useMetrics";
import { TimeRangeSelector } from "../components/TimeRangeSelector";
import { DoughnutChart } from "../components/charts/DoughnutChart";
import { MetricsTable } from "../components/tables/MetricsTable";
import { StatCard } from "../components/cards/StatCard";
import { Pagination } from "../components/Pagination";
import { DebouncedSearchInput } from "../components/DebouncedSearchInput";
import { ErrorMessageCell } from "../components/errors/ErrorMessageCell";
import { IconChevronDown, IconFilter } from "../components/icons";
import { formatTime } from "../utils/format";

interface ErrorExpandContextValue {
  expandedId: number | null;
  toggleExpand: (timestamp: number) => void;
}

const ErrorExpandContext = createContext<ErrorExpandContextValue | null>(null);

function ErrorMessageColumn({ row }: { row: ErrorLogRow }) {
  const ctx = useContext(ErrorExpandContext);
  if (!ctx) return <span>{row.error_msg || "-"}</span>;
  return (
    <ErrorMessageCell
      row={row}
      expanded={ctx.expandedId === row.timestamp}
      onToggle={ctx.toggleExpand}
    />
  );
}

const DIST_LABELS = ["2xx", "3xx", "4xx", "5xx"];
const DIST_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444"];

const errorLogColumns = [
  {
    key: "timestamp",
    header: "Time",
    render: (r: ErrorLogRow) => formatTime(r.timestamp),
  },
  { key: "method", header: "Method" },
  { key: "path", header: "Path" },
  {
    key: "status_code",
    header: "Status",
    align: "center" as const,
    render: (r: ErrorLogRow) => (
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
    align: "right" as const,
    render: (r: ErrorLogRow) => `${r.duration_ms.toFixed(1)}ms`,
  },
  {
    key: "error_msg",
    header: "Message",
    render: (r: ErrorLogRow) => <ErrorMessageColumn row={r} />,
  },
];

export function Errors() {
  const {
    range,
    rangeSyncToken,
    getRange,
    setCustomRange,
    resetToDefault,
    isDefaultLastHour,
  } = useTimeRange();
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [errorPage, setErrorPage] = useState(1);
  const [errorLimit, setErrorLimit] = useState(200);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const handleDebouncedSearch = useCallback((value: string) => {
    setDebouncedSearch(value);
  }, []);

  const toggleExpand = useCallback((timestamp: number) => {
    setExpandedId((prev) => (prev === timestamp ? null : timestamp));
  }, []);

  const { data: statusCodesData } = usePolledData(
    async (from, to) => {
      const { codes } = await fetchErrorStatusCodes(from, to);
      return Array.isArray(codes) ? codes : [];
    },
    getRange,
    10000,
    [],
    { initialDelayMs: 0 },
  );
  const statusCodes = statusCodesData ?? [];

  useEffect(() => {
    if (statusFilter === "all") return;
    const n = parseInt(statusFilter, 10);
    if (!Number.isFinite(n) || !statusCodes.includes(n)) {
      setStatusFilter("all");
    }
  }, [statusCodes, statusFilter]);

  useEffect(() => {
    setErrorPage(1);
    setExpandedId(null);
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
    10000,
    [debouncedSearch, statusFilter],
    { initialDelayMs: 150 },
  );
  const { data: distribution } = usePolledData(
    fetchStatusDistribution,
    getRange,
    10000,
    [],
    { initialDelayMs: 300 },
  );

  const errorList = errorsPaginated?.data ?? [];
  const totalErrors = errorsPaginated?.pagination?.total ?? 0;
  const dist = distribution ?? { status_2xx: 0, status_3xx: 0, status_4xx: 0, status_5xx: 0 };
  const total = dist.status_2xx + dist.status_3xx + dist.status_4xx + dist.status_5xx;

  const distData = useMemo(
    () => [dist.status_2xx, dist.status_3xx, dist.status_4xx, dist.status_5xx],
    [dist.status_2xx, dist.status_3xx, dist.status_4xx, dist.status_5xx],
  );

  const expandContext = useMemo(
    () => ({ expandedId, toggleExpand }),
    [expandedId, toggleExpand],
  );

  const expandedRow = useMemo(() => {
    if (expandedId === null) return null;
    return errorList.find((e) => e.timestamp === expandedId) ?? null;
  }, [expandedId, errorList]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Errors</h1>
        <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-3">
          <div className="flex flex-1 flex-wrap items-center gap-2 min-w-0">
            <DebouncedSearchInput
              onDebouncedChange={handleDebouncedSearch}
              ariaLabel="Search errors"
              className="w-full text-sm pl-9 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:ring-1 focus:ring-blue-500 min-w-[200px] max-w-md"
            />
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
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Status Distribution
          </h3>
          {total > 0 ? (
            <DoughnutChart
              labels={DIST_LABELS}
              data={distData}
              colors={DIST_COLORS}
            />
          ) : (
            <div className="flex items-center justify-center h-[250px] text-gray-400">
              No request data
            </div>
          )}
        </div>

        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Error Log
          </h3>
          <ErrorExpandContext.Provider value={expandContext}>
            <MetricsTable<ErrorLogRow>
              columns={errorLogColumns}
              data={errorList}
              keyExtractor={(r, i) => `${r.timestamp}:${r.path}:${i}`}
              emptyMessage="No errors recorded"
            />
          </ErrorExpandContext.Provider>

          {expandedRow !== null && (
            <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
              <h4 className="text-sm font-medium mb-2">Stack Trace</h4>
              <pre className="text-xs text-gray-600 dark:text-gray-400 overflow-x-auto whitespace-pre-wrap">
                {expandedRow.stack_trace || "No stack trace available"}
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
