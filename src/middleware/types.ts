import type { MetricsStore } from "../core/metrics-store.js";
import type { DatabaseAdapter, ResolvedConfig } from "../types.js";

export interface MiddlewareContext {
  config: ResolvedConfig;
  db: DatabaseAdapter;
  metricsStore: MetricsStore;
}
