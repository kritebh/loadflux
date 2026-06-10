import type { ChartOptions } from "chart.js";

export function isDarkMode(): boolean {
  return document.documentElement.classList.contains("dark");
}

export function chartLegendColor(isDark: boolean): string {
  return isDark ? "#9ca3af" : "#6b7280";
}

export function chartTickColor(isDark: boolean): string {
  return isDark ? "#6b7280" : "#9ca3af";
}

export function chartGridColor(isDark: boolean): string {
  return isDark ? "#1f293780" : "#f3f4f680";
}

export function chartTooltipOptions(isDark: boolean) {
  return {
    backgroundColor: isDark ? "#1f2937" : "#ffffff",
    titleColor: isDark ? "#f3f4f6" : "#111827",
    bodyColor: isDark ? "#d1d5db" : "#4b5563",
    borderColor: isDark ? "#374151" : "#e5e7eb",
    borderWidth: 1,
    padding: 10,
    cornerRadius: 8,
  };
}

export function chartAxisTitleOptions(isDark: boolean, text: string) {
  return {
    display: true,
    text,
    color: chartTickColor(isDark),
  };
}
