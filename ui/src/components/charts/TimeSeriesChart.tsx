import { memo, useMemo } from "react";
import { Line } from "react-chartjs-2";
import type { ChartOptions } from "chart.js";
import { useTheme } from "../../hooks/useTheme";
import {
  chartLegendColor,
  chartTickColor,
  chartGridColor,
  chartTooltipOptions,
  chartAxisTitleOptions,
} from "../../utils/chartTheme";

interface Dataset {
  label: string;
  data: number[];
  color: string;
  fill?: boolean;
}

interface Props {
  labels: string[];
  datasets: Dataset[];
  yLabel?: string;
  yMax?: number;
  height?: number;
}

export const TimeSeriesChart = memo(function TimeSeriesChart({ labels, datasets, yLabel, yMax, height = 250 }: Props) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const data = useMemo(
    () => ({
      labels,
      datasets: datasets.map((ds) => ({
        label: ds.label,
        data: ds.data,
        borderColor: ds.color,
        backgroundColor: ds.fill ? `${ds.color}20` : "transparent",
        fill: ds.fill ?? false,
        tension: 0.3,
        pointRadius: 0,
        pointHitRadius: 10,
        borderWidth: 2,
      })),
    }),
    [labels, datasets],
  );

  const options: ChartOptions<"line"> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      // Data arrives pre-parsed and time-ordered from the API, so Chart.js
      // can skip its internal normalization pass.
      normalized: true,
      spanGaps: true,
      animations: {
        colors: false,
        numbers: false,
      },
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          display: datasets.length > 1,
          position: "top",
          labels: {
            usePointStyle: true,
            pointStyle: "circle",
            boxWidth: 6,
            padding: 16,
            color: chartLegendColor(isDark),
          },
        },
        tooltip: chartTooltipOptions(isDark),
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 8,
            color: chartTickColor(isDark),
          },
          grid: { display: false },
        },
        y: {
          title: yLabel ? chartAxisTitleOptions(isDark, yLabel) : undefined,
          max: yMax,
          ticks: {
            color: chartTickColor(isDark),
          },
          grid: {
            color: chartGridColor(isDark),
          },
        },
      },
    }),
    [datasets.length, isDark, yLabel, yMax],
  );

  return (
    <div style={{ height }}>
      <Line data={data} options={options} />
    </div>
  );
});
