import { useMemo } from "react";
import { Doughnut } from "react-chartjs-2";
import type { ChartOptions } from "chart.js";
import { useTheme } from "../../hooks/useTheme";
import {
  chartLegendColor,
  chartTooltipOptions,
} from "../../utils/chartTheme";

interface Props {
  labels: string[];
  data: number[];
  colors: string[];
  height?: number;
}

export function DoughnutChart({ labels, data, colors, height = 250 }: Props) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const chartData = useMemo(
    () => ({
      labels,
      datasets: [
        {
          data,
          backgroundColor: colors,
          borderColor: isDark ? "#1f2937" : "#ffffff",
          borderWidth: 2,
        },
      ],
    }),
    [labels, data, colors, isDark],
  );

  const options: ChartOptions<"doughnut"> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      cutout: "60%",
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            usePointStyle: true,
            pointStyle: "circle",
            boxWidth: 8,
            padding: 16,
            color: chartLegendColor(isDark),
          },
        },
        tooltip: chartTooltipOptions(isDark),
      },
    }),
    [isDark],
  );

  return (
    <div style={{ height }}>
      <Doughnut data={chartData} options={options} />
    </div>
  );
}
