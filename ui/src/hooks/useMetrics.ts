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

export interface PollOptions {
  /** Delay first fetch (ms) to stagger parallel hooks on the same page. */
  initialDelayMs?: number;
}

type IsCurrent = () => boolean;

/**
 * Deep equality for JSON-shaped API payloads (bounded: ≤2000 series points /
 * ≤1000 table rows). Lets polled state keep its previous reference when a tick
 * returns identical data, so memoized charts/tables skip re-rendering.
 */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!jsonEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(b)) {
    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;
    const keysA = Object.keys(objA);
    if (keysA.length !== Object.keys(objB).length) return false;
    for (const key of keysA) {
      if (!jsonEqual(objA[key], objB[key])) return false;
    }
    return true;
  }
  return false;
}

function usePollingCore(
  poll: (isCurrent: IsCurrent, showSpinner: boolean) => Promise<void>,
  restartDeps: DependencyList,
  intervalMs: number,
  pollOptions?: PollOptions,
) {
  const genRef = useRef(0);
  const pollRef = useRef(poll);
  pollRef.current = poll;
  const inFlightRef = useRef(false);
  const initialDelayMs = pollOptions?.initialDelayMs ?? 0;

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;
    let delayId: ReturnType<typeof setTimeout> | undefined;
    let firstRun = true;

    const run = async (showSpinner: boolean) => {
      if (document.hidden) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const gen = ++genRef.current;
      const isCurrent = () => genRef.current === gen;
      try {
        await pollRef.current(isCurrent, showSpinner);
      } finally {
        inFlightRef.current = false;
      }
    };

    const startInterval = () => {
      void run(true);
      firstRun = false;
      intervalId = setInterval(() => void run(false), intervalMs);
    };

    if (initialDelayMs > 0) {
      delayId = setTimeout(startInterval, initialDelayMs);
    } else {
      startInterval();
    }

    const onVisibility = () => {
      if (!document.hidden) void run(firstRun);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      genRef.current += 1;
      // Release the in-flight guard so the next effect run (after a restartDep
      // change) refetches immediately instead of bailing until the next tick.
      // The prior request's result is already discarded via isCurrent()/genRef.
      inFlightRef.current = false;
      if (delayId !== undefined) clearTimeout(delayId);
      if (intervalId !== undefined) clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, initialDelayMs, ...restartDeps]);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const gen = ++genRef.current;
    const isCurrent = () => genRef.current === gen;
    try {
      await pollRef.current(isCurrent, true);
    } finally {
      inFlightRef.current = false;
    }
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
  refreshDeps: DependencyList = [],
  pollOptions?: PollOptions,
) {
  const [data, setData] = useState<T | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const getRangeRef = useRef(getRange);
  getRangeRef.current = getRange;
  const hasDataRef = useRef(false);

  const refresh = usePollingCore(
    async (isCurrent, showSpinner) => {
      if (!isCurrent()) return;
      const shouldSpin = showSpinner || !hasDataRef.current;
      if (shouldSpin) setFetching(true);
      try {
        const { from, to } = getRangeRef.current();
        const result = await fetcherRef.current(from, to);
        if (!isCurrent()) return;
        startTransition(() => {
          if (!isCurrent()) return;
          setData((prev) => (prev !== null && jsonEqual(prev, result) ? prev : result));
          hasDataRef.current = true;
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
        if (isCurrent() && shouldSpin) setFetching(false);
      }
    },
    [getRange, ...refreshDeps],
    intervalMs,
    pollOptions,
  );

  return {
    data,
    loading: data === null && fetching,
    refreshing: data !== null && fetching,
    error,
    refresh,
  };
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
  refreshDeps: DependencyList = [],
  pollOptions?: PollOptions,
) {
  const [data, setData] = useState<PaginatedResponse<T> | null>(null);
  const [fetching, setFetching] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const getRangeRef = useRef(getRange);
  getRangeRef.current = getRange;
  const hasDataRef = useRef(false);

  const refresh = usePollingCore(
    async (isCurrent, showSpinner) => {
      if (!isCurrent()) return;
      const shouldSpin = showSpinner || !hasDataRef.current;
      if (shouldSpin) setFetching(true);
      try {
        const { from, to } = getRangeRef.current();
        const result = await fetcherRef.current(from, to, page, limit);
        if (!isCurrent()) return;
        startTransition(() => {
          if (!isCurrent()) return;
          setData((prev) => (prev !== null && jsonEqual(prev, result) ? prev : result));
          hasDataRef.current = true;
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AuthError") throw err;
      } finally {
        if (isCurrent() && shouldSpin) setFetching(false);
      }
    },
    [getRange, page, limit, ...refreshDeps],
    intervalMs,
    pollOptions,
  );

  return {
    data,
    loading: data === null && fetching,
    refreshing: data !== null && fetching,
    refresh,
  };
}
