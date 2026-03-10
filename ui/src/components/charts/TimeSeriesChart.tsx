import { Line } from "react-chartjs-2";
import type { ChartOptions } from "chart.js";

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

export function TimeSeriesChart({ labels, datasets, yLabel, yMax, height = 250 }: Props) {
  const data = {
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
  };

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
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
          color: document.documentElement.classList.contains("dark")
            ? "#9ca3af"
            : "#6b7280",
        },
      },
      tooltip: {
        backgroundColor: document.documentElement.classList.contains("dark")
          ? "#1f2937"
          : "#ffffff",
        titleColor: document.documentElement.classList.contains("dark")
          ? "#f3f4f6"
          : "#111827",
        bodyColor: document.documentElement.classList.contains("dark")
          ? "#d1d5db"
          : "#4b5563",
        borderColor: document.documentElement.classList.contains("dark")
          ? "#374151"
          : "#e5e7eb",
        borderWidth: 1,
        padding: 10,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        ticks: {
          maxTicksLimit: 8,
          color: document.documentElement.classList.contains("dark")
            ? "#6b7280"
            : "#9ca3af",
        },
        grid: { display: false },
      },
      y: {
        title: yLabel
          ? {
              display: true,
              text: yLabel,
              color: document.documentElement.classList.contains("dark")
                ? "#6b7280"
                : "#9ca3af",
            }
          : undefined,
        max: yMax,
        ticks: {
          color: document.documentElement.classList.contains("dark")
            ? "#6b7280"
            : "#9ca3af",
        },
        grid: {
          color: document.documentElement.classList.contains("dark")
            ? "#1f293780"
            : "#f3f4f680",
        },
      },
    },
  };

  return (
    <div style={{ height }}>
      <Line data={data} options={options} />
    </div>
  );
}
