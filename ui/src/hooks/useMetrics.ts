import {
  useState,
  useEffect,
  useCallback,
  useRef,
  startTransition,
  type DependencyList,
} from "react";
import type { PaginatedResponse } from "../api/client";

export interface TimeRangeValue {
  from: number;
  to: number;
}

type IsCurrent = () => boolean;

function usePollingCore(
  poll: (isCurrent: IsCurrent) => Promise<void>,
  restartDeps: DependencyList,
  intervalMs: number,
) {
  const genRef = useRef(0);
  const pollRef = useRef(poll);
  pollRef.current = poll;

  useEffect(() => {
    const run = async () => {
      const gen = ++genRef.current;
      const isCurrent = () => genRef.current === gen;
      await pollRef.current(isCurrent);
    };
    void run();
    const id = setInterval(() => void run(), intervalMs);
    return () => {
      genRef.current += 1;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...restartDeps]);

  const refresh = useCallback(async () => {
    const gen = ++genRef.current;
    const isCurrent = () => genRef.current === gen;
    await pollRef.current(isCurrent);
  }, []);

  return refresh;
}

export function useTimeRange(defaultMs = 60 * 60 * 1000) {
  const [customRange, setCustomRangeState] = useState<TimeRangeValue | null>(null);
  /** Bumps only on Apply / Reset so date inputs are not reset every render (rolling `Date.now()`). */
  const [rangeSyncToken, setRangeSyncToken] = useState(0);

  const setCustomRange = useCallback((r: TimeRangeValue) => {
    setCustomRangeState(r);
    setRangeSyncToken((t) => t + 1);
  }, []);

  const resetToDefault = useCallback(() => {
    setCustomRangeState(null);
    setRangeSyncToken((t) => t + 1);
  }, []);

  const getRange = useCallback(() => {
    if (customRange) {
      return customRange;
    }
    const now = Date.now();
    return { from: now - defaultMs, to: now };
  }, [customRange, defaultMs]);

  const currentRange = getRange();
  return {
    range: currentRange,
    rangeSyncToken,
    getRange,
    setCustomRange,
    resetToDefault,
    isDefaultLastHour: customRange === null && defaultMs === 60 * 60 * 1000,
  };
}

export function usePolledData<T>(
  fetcher: (from: number, to: number) => Promise<T>,
  getRange: () => TimeRangeValue,
  intervalMs = 10000,
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const getRangeRef = useRef(getRange);
  getRangeRef.current = getRange;

  const refresh = usePollingCore(
    async (isCurrent) => {
      try {
        const { from, to } = getRangeRef.current();
        const result = await fetcherRef.current(from, to);
        if (!isCurrent()) return;
        startTransition(() => {
          if (!isCurrent()) return;
          setData(result);
          setError(null);
        });
      } catch (err: unknown) {
        if (!isCurrent()) return;
        if (err instanceof Error && err.name === "AuthError") throw err;
        startTransition(() => {
          if (!isCurrent()) return;
          setError(err instanceof Error ? err.message : "Unknown error");
        });
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    [getRange],
    intervalMs,
  );

  return { data, loading, error, refresh };
}

export function usePaginatedPolledData<T>(
  fetcher: (
    from: number,
    to: number,
    page: number,
    limit: number,
  ) => Promise<PaginatedResponse<T>>,
  getRange: () => TimeRangeValue,
  page: number,
  limit = 200,
  intervalMs = 10000,
) {
  const [data, setData] = useState<PaginatedResponse<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const getRangeRef = useRef(getRange);
  getRangeRef.current = getRange;

  const refresh = usePollingCore(
    async (isCurrent) => {
      try {
        const { from, to } = getRangeRef.current();
        const result = await fetcherRef.current(from, to, page, limit);
        if (!isCurrent()) return;
        startTransition(() => {
          if (!isCurrent()) return;
          setData(result);
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AuthError") throw err;
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    [getRange, page, limit],
    intervalMs,
  );

  return { data, loading, refresh };
}
