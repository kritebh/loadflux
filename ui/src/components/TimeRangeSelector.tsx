import { useEffect, useMemo, useRef, useState } from "react";
import type { TimeRangeValue } from "../hooks/useMetrics";
import { IconCheck, IconClock } from "./icons";

interface Props {
  range: TimeRangeValue;
  /** Increment when Apply or Reset is used; do not tie inputs to `range` on every render. */
  rangeSyncToken: number;
  isDefaultLastHour: boolean;
  onApply: (range: TimeRangeValue) => void;
  onResetDefault: () => void;
}

function splitLocal(ts: number): { date: string; time: string } {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return { date: `${y}-${m}-${day}`, time: `${h}:${min}` };
}

function combineLocal(date: string, time: string): number {
  return new Date(`${date}T${time}`).getTime();
}

function openNativePicker(input: HTMLInputElement | null) {
  if (!input) return;
  try {
    input.showPicker();
  } catch {
    input.focus();
    input.click();
  }
}

function NativePickerField({
  type,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  type: "date" | "time";
  value: string;
  onChange: (v: string) => void;
  className?: string;
  "aria-label": string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  const activate = () => openNativePicker(ref.current);

  return (
    <div
      className={[
        "lf-picker-shell flex items-center rounded-lg border px-2 py-1.5 min-h-8 cursor-pointer transition-[border-color,box-shadow,background-color] select-none",
        "border-gray-200 bg-white text-gray-900 shadow-sm",
        "dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100 dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]",
        "hover:border-blue-400/70 dark:hover:border-blue-500/45",
        "focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/25 dark:focus-within:ring-blue-400/20",
        className ?? "",
      ].join(" ")}
      onClick={(e) => {
        e.preventDefault();
        activate();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      }}
    >
      <input
        ref={ref}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          activate();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            activate();
            return;
          }
          if (e.key === "ArrowDown" && !e.altKey) {
            e.preventDefault();
            activate();
          }
        }}
        className="lf-native-date w-full min-w-0 border-0 bg-transparent p-0 text-xs font-medium tabular-nums text-inherit outline-none cursor-pointer"
        aria-label={ariaLabel}
      />
    </div>
  );
}

export function TimeRangeSelector({
  range,
  rangeSyncToken,
  isDefaultLastHour,
  onApply,
  onResetDefault,
}: Props) {
  const [fromDate, setFromDate] = useState(() => splitLocal(range.from).date);
  const [fromTime, setFromTime] = useState(() => splitLocal(range.from).time);
  const [toDate, setToDate] = useState(() => splitLocal(range.to).date);
  const [toTime, setToTime] = useState(() => splitLocal(range.to).time);

  // Sync from parent only after explicit Apply / Reset — never on rolling Date.now() re-renders.
  useEffect(() => {
    if (rangeSyncToken === 0) return;
    const a = splitLocal(range.from);
    const b = splitLocal(range.to);
    setFromDate(a.date);
    setFromTime(a.time);
    setToDate(b.date);
    setToTime(b.time);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `range` drifts every render in default mode; token drives sync only
  }, [rangeSyncToken]);

  const canApply = useMemo(() => {
    if (!fromDate || !fromTime || !toDate || !toTime) return false;
    const fromMs = combineLocal(fromDate, fromTime);
    const toMs = combineLocal(toDate, toTime);
    return Number.isFinite(fromMs) && Number.isFinite(toMs) && fromMs < toMs;
  }, [fromDate, fromTime, toDate, toTime]);

  const dotTitle = isDefaultLastHour
    ? "Time window: last 1 hour (default, rolling)"
    : "Time window: custom range";

  const handleApply = () => {
    if (!canApply) return;
    onApply({
      from: combineLocal(fromDate, fromTime),
      to: combineLocal(toDate, toTime),
    });
  };

  return (
    <div
      className="inline-flex flex-col gap-2 rounded-xl border border-gray-200/90 bg-white px-2 py-2 shadow-sm sm:inline-flex sm:flex-row sm:items-center sm:flex-wrap dark:border-gray-700 dark:bg-gray-900 dark:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.04)]"
      role="group"
      aria-label="Time range"
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className="inline-flex items-center justify-center w-7 h-8 shrink-0"
          title={dotTitle}
        >
          <span
            className={`h-2 w-2 rounded-full shrink-0 ${
              isDefaultLastHour
                ? "bg-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.25)]"
                : "bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.2)]"
            }`}
          />
        </span>
        <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
          From
        </span>
        <NativePickerField
          type="date"
          value={fromDate}
          onChange={setFromDate}
          className="w-[9rem] sm:w-[9.25rem]"
          aria-label="From date"
        />
        <NativePickerField
          type="time"
          value={fromTime}
          onChange={setFromTime}
          className="w-[5.75rem]"
          aria-label="From time"
        />
        <span className="text-[10px] text-gray-400 dark:text-gray-500 px-0.5">
          –
        </span>
        <NativePickerField
          type="date"
          value={toDate}
          onChange={setToDate}
          className="w-[9rem] sm:w-[9.25rem]"
          aria-label="To date"
        />
        <NativePickerField
          type="time"
          value={toTime}
          onChange={setToTime}
          className="w-[5.75rem]"
          aria-label="To time"
        />
      </div>
      <div className="flex items-center gap-2 shrink-0 sm:pl-1">
        <button
          type="button"
          onClick={handleApply}
          disabled={!canApply}
          title={!canApply ? "Set an end time after the start time" : "Apply this range"}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-blue-500 text-white text-xs font-medium shadow-sm shadow-blue-900/20 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors dark:shadow-blue-950/40"
        >
          <IconCheck className="w-3.5 h-3.5 shrink-0" />
          Apply
        </button>
        <button
          type="button"
          onClick={onResetDefault}
          title="Reset to last 1 hour"
          className={`inline-flex items-center gap-1 h-8 px-2 rounded-lg border text-xs transition-colors ${
            isDefaultLastHour
              ? "border-blue-400/60 text-blue-600 dark:text-blue-200 bg-blue-50 dark:bg-blue-500/15 dark:border-blue-400/35"
              : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          }`}
        >
          <IconClock className="w-3.5 h-3.5 shrink-0" />
          Last 1h
        </button>
      </div>
    </div>
  );
}
