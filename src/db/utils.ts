import type { OverviewMetrics } from "../types.js";
import { EMPTY_OVERVIEW_BASE, withRpsRpm } from "./constants.js";

export function logDbError(context: string, err: unknown): void {
  console.error(`[LoadFlux] ${context} failed:`, err);
}

export function fireAndForget<T>(
  promise: Promise<T>,
  context: string,
): void {
  promise.catch((err) => {
    logDbError(context, err);
  });
}

export function emptyOverview(range: { from: number; to: number }): OverviewMetrics {
  return withRpsRpm(range, EMPTY_OVERVIEW_BASE);
}

