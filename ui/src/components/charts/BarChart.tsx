import { memo, useMemo } from "react";
import { Bar } from "react-chartjs-2";
import type { ChartOptions } from "chart.js";
import { useTheme } from "../../hooks/useTheme";
import {
  chartTickColor,
  chartGridColor,
  chartTooltipOptions,
} from "../../utils/chartTheme";

interface Props {
  labels: string[];
  data: number[];
  label: string;
  color?: string;
  horizontal?: boolean;
  height?: number;
}

export const BarChart = memo(function BarChart({
  labels,
  data,
  label,
  color = "#3b82f6",
  horizontal = false,
  height = 250,
}: Props) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const chartData = useMemo(
    () => ({
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
    }),
    [labels, data, label, color],
  );

  const options: ChartOptions<"bar"> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      indexAxis: horizontal ? "y" : "x",
      plugins: {
        legend: { display: false },
        tooltip: chartTooltipOptions(isDark),
      },
      scales: {
        x: {
          ticks: {
            color: chartTickColor(isDark),
            maxTicksLimit: horizontal ? undefined : 8,
          },
          grid: { display: false },
        },
        y: {
          ticks: { color: chartTickColor(isDark) },
          grid: {
            color: chartGridColor(isDark),
          },
        },
      },
    }),
    [horizontal, isDark],
  );

  return (
    <div style={{ height }}>
      <Bar data={chartData} options={options} />
    </div>
  );
});
