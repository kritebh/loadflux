import type { LoadFluxConfig, ResolvedConfig } from "./types.js";
import path from "path";

const DEFAULTS = {
  path: "/loadflux",
  framework: "express" as const,
  database: {
    adapter: "sqlite" as const,
    connectionString: path.resolve(process.cwd(), "loadflux.db"),
  },
  collection: {
    systemInterval: 5000,
    aggregationWindow: 5000,
  },
  retention: {
    days: 90,
    cronExpression: "0 2 * * *",
  },
  slowRequestThreshold: 500,
  excludeRoutes: [] as string[],
};

export function resolveConfig(
  userConfig: LoadFluxConfig = {}
): ResolvedConfig {
  const dbAdapter = userConfig.database?.adapter ?? DEFAULTS.database.adapter;

  let connectionString: string;
  if (userConfig.database?.connectionString) {
    connectionString = userConfig.database.connectionString;
  } else if (dbAdapter === "mongodb") {
    connectionString = "mongodb://localhost:27017/loadflux";
  } else {
    connectionString = DEFAULTS.database.connectionString;
  }

  const resolved: ResolvedConfig = {
    path: normalizePath(userConfig.path ?? DEFAULTS.path),
    framework: userConfig.framework ?? DEFAULTS.framework,
    database: {
      adapter: dbAdapter,
      connectionString,
    },
    auth: userConfig.auth ?? null,
    collection: {
      systemInterval:
        userConfig.collection?.systemInterval ??
        DEFAULTS.collection.systemInterval,
      aggregationWindow:
        userConfig.collection?.aggregationWindow ??
        DEFAULTS.collection.aggregationWindow,
    },
    retention: {
      days: userConfig.retention?.days ?? DEFAULTS.retention.days,
      cronExpression:
        userConfig.retention?.cronExpression ??
        DEFAULTS.retention.cronExpression,
    },
    slowRequestThreshold:
      userConfig.slowRequestThreshold ?? DEFAULTS.slowRequestThreshold,
    excludeRoutes: userConfig.excludeRoutes ?? DEFAULTS.excludeRoutes,
  };

  validate(resolved);
  return resolved;
}

function normalizePath(p: string): string {
  if (!p.startsWith("/")) p = "/" + p;
  if (p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

function validate(config: ResolvedConfig): void {
  if (config.collection.systemInterval < 1000) {
    throw new Error("LoadFlux: systemInterval must be >= 1000ms");
  }
  if (config.collection.aggregationWindow < 1000) {
    throw new Error("LoadFlux: aggregationWindow must be >= 1000ms");
  }
  if (config.retention.days < 1) {
    throw new Error("LoadFlux: retention days must be >= 1");
  }
  if (config.slowRequestThreshold < 0) {
    throw new Error("LoadFlux: slowRequestThreshold must be >= 0");
  }
  if (!["sqlite", "mongodb"].includes(config.database.adapter)) {
    throw new Error(
      `LoadFlux: unsupported database adapter "${config.database.adapter}"`
    );
  }
}
