import { useState, useEffect, useCallback } from "react";

export interface TimeRangeOption {
  label: string;
  value: number; // ms from now
}

export const TIME_RANGES: TimeRangeOption[] = [
  { label: "5m", value: 5 * 60 * 1000 },
  { label: "15m", value: 15 * 60 * 1000 },
  { label: "30m", value: 30 * 60 * 1000 },
  { label: "1h", value: 60 * 60 * 1000 },
  { label: "6h", value: 6 * 60 * 60 * 1000 },
  { label: "12h", value: 12 * 60 * 60 * 1000 },
  { label: "24h", value: 24 * 60 * 60 * 1000 },
  { label: "7d", value: 7 * 24 * 60 * 60 * 1000 },
  { label: "15d", value: 15 * 24 * 60 * 60 * 1000 },
  { label: "30d", value: 30 * 24 * 60 * 60 * 1000 },
];

export function useTimeRange(defaultMs = 60 * 60 * 1000) {
  const [rangeMs, setRangeMs] = useState(defaultMs);

  const getRange = useCallback(() => {
    const now = Date.now();
    return { from: now - rangeMs, to: now };
  }, [rangeMs]);

  return { rangeMs, setRangeMs, getRange };
}

export function usePolledData<T>(
  fetcher: (from: number, to: number) => Promise<T>,
  rangeMs: number,
  intervalMs = 10000
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const now = Date.now();
      const result = await fetcher(now - rangeMs, now);
      setData(result);
      setError(null);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AuthError") throw err;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [fetcher, rangeMs]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  return { data, loading, error, refresh };
}
