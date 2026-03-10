import { Doughnut } from "react-chartjs-2";
import type { ChartOptions } from "chart.js";

interface Props {
  value: number;
  max?: number;
  label: string;
  color?: string;
  suffix?: string;
}

function getColor(value: number, max: number): string {
  const pct = value / max;
  if (pct < 0.6) return "#10b981";
  if (pct < 0.85) return "#f59e0b";
  return "#ef4444";
}

export function GaugeChart({ value, max = 100, label, color, suffix = "%" }: Props) {
  const clamped = Math.min(Math.max(value, 0), max);
  const gaugeColor = color || getColor(clamped, max);

  const data = {
    datasets: [
      {
        data: [clamped, max - clamped],
        backgroundColor: [gaugeColor, document.documentElement.classList.contains("dark") ? "#374151" : "#e5e7eb"],
        borderWidth: 0,
        circumference: 240,
        rotation: 240,
      },
    ],
  };

  const options: ChartOptions<"doughnut"> = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "78%",
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false },
    },
  };

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-40 h-32">
        <Doughnut data={data} options={options} />
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
          <span className="text-2xl font-bold" style={{ color: gaugeColor }}>
            {typeof value === "number" ? value.toFixed(1) : value}
            <span className="text-sm font-normal">{suffix}</span>
          </span>
        </div>
      </div>
      <span className="text-sm text-gray-500 dark:text-gray-400 mt-1">
        {label}
      </span>
    </div>
  );
}
