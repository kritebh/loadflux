import { Bar } from "react-chartjs-2";
import type { ChartOptions } from "chart.js";

interface Props {
  labels: string[];
  data: number[];
  label: string;
  color?: string;
  horizontal?: boolean;
  height?: number;
}

export function BarChart({
  labels,
  data,
  label,
  color = "#3b82f6",
  horizontal = false,
  height = 250,
}: Props) {
  const isDark = document.documentElement.classList.contains("dark");

  const chartData = {
    labels,
    datasets: [
      {
        label,
        data,
        backgroundColor: `${color}cc`,
        borderColor: color,
        borderWidth: 1,
        borderRadius: 4,
        maxBarThickness: 40,
      },
    ],
  };

  const options: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? "y" : "x",
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: isDark ? "#1f2937" : "#ffffff",
        titleColor: isDark ? "#f3f4f6" : "#111827",
        bodyColor: isDark ? "#d1d5db" : "#4b5563",
        borderColor: isDark ? "#374151" : "#e5e7eb",
        borderWidth: 1,
        padding: 10,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        ticks: {
          color: isDark ? "#6b7280" : "#9ca3af",
          maxTicksLimit: horizontal ? undefined : 8,
        },
        grid: { display: false },
      },
      y: {
        ticks: { color: isDark ? "#6b7280" : "#9ca3af" },
        grid: {
          color: isDark ? "#1f293780" : "#f3f4f680",
        },
      },
    },
  };

  return (
    <div style={{ height }}>
      <Bar data={chartData} options={options} />
    </div>
  );
}
