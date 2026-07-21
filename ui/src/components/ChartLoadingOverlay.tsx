interface Props {
  label?: string;
}

export function ChartLoadingOverlay({ label = "Updating chart…" }: Props) {
  return (
    <div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg bg-white/70 dark:bg-gray-900/70 backdrop-blur-[1px]"
      aria-busy="true"
      aria-live="polite"
    >
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500 dark:border-gray-600 dark:border-t-blue-400"
        aria-hidden="true"
      />
      <span className="mt-2 text-sm text-gray-500 dark:text-gray-400">{label}</span>
    </div>
  );
}
