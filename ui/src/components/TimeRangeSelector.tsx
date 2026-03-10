import { TIME_RANGES } from "../hooks/useMetrics";

interface Props {
  value: number;
  onChange: (ms: number) => void;
}

export function TimeRangeSelector({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
      {TIME_RANGES.map((r) => (
        <button
          key={r.value}
          onClick={() => onChange(r.value)}
          className={`px-3 py-1 text-sm rounded-md transition-colors ${
            value === r.value
              ? "bg-blue-500 text-white shadow-sm"
              : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
