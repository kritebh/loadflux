import type { LoadFluxConfig } from "./types.js";
import { resolveConfig } from "./config.js";
import { SQLiteAdapter } from "./db/sqlite.js";
import { MongoDBAdapter } from "./db/mongodb.js";
import { MetricsStore } from "./core/metrics-store.js";
import { startRetentionCron, stopRetentionCron } from "./core/cron.js";
import { setupInitialAuth } from "./auth/auth.js";
import { createExpressMiddleware } from "./middleware/express.js";
import { createFastifyPlugin } from "./middleware/fastify.js";
import type { MiddlewareContext } from "./middleware/types.js";

// Track all active contexts for graceful shutdown
const activeContexts: MiddlewareContext[] = [];
let shutdownRegistered = false;

function registerShutdownHandlers(): void {
  if (shutdownRegistered) return;
  shutdownRegistered = true;

  const shutdown = async () => {
    for (const ctx of activeContexts) {
      ctx.metricsStore.stop();
      stopRetentionCron();
      await ctx.db.close();
    }
    activeContexts.length = 0;
  };

  process.on("SIGINT", async () => {
    await shutdown();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await shutdown();
    process.exit(0);
  });
}

async function createContext(
  userConfig?: LoadFluxConfig
): Promise<MiddlewareContext> {
  const config = resolveConfig(userConfig);

  // Create database adapter
  const db =
    config.database.adapter === "mongodb"
      ? new MongoDBAdapter(config.database.connectionString)
      : new SQLiteAdapter(config.database.connectionString);

  await db.connect();

  // Setup initial auth if provided in config
  if (config.auth) {
    await setupInitialAuth(db, config.auth.username, config.auth.password);
  }

  // Start metrics collection
  const metricsStore = new MetricsStore(db, config);
  metricsStore.start();

  // Start retention cleanup cron
  startRetentionCron(db, config);

  const ctx = { config, db, metricsStore };
  activeContexts.push(ctx);
  registerShutdownHandlers();

  return ctx;
}

/**
 * Create LoadFlux Express middleware.
 *
 * @example
 * ```ts
 * import express from "express";
 * import { loadflux } from "loadflux";
 *
 * const app = express();
 * app.use(loadflux());
 * app.listen(3000);
 * // Dashboard at http://localhost:3000/loadflux
 * ```
 */
export function loadflux(userConfig?: LoadFluxConfig) {
  const config = resolveConfig({ ...userConfig, framework: "express" });

  // We need to initialize async but return sync middleware.
  // Use a lazy init pattern: first request triggers initialization.
  let ctx: MiddlewareContext | null = null;
  let initPromise: Promise<MiddlewareContext> | null = null;
  let middleware: ReturnType<typeof createExpressMiddleware> | null = null;

  function ensureInit(): Promise<MiddlewareContext> {
    if (!initPromise) {
      initPromise = createContext({ ...userConfig, framework: "express" }).then(
        (c) => {
          ctx = c;
          middleware = createExpressMiddleware(c);
          return c;
        }
      );
    }
    return initPromise;
  }

  // Start init immediately (don't wait for first request)
  ensureInit().catch((err) => {
    console.error("[LoadFlux] Initialization failed:", err);
  });

  return function loadfluxHandler(req: any, res: any, next: any) {
    if (middleware) {
      return middleware(req, res, next);
    }
    // Still initializing — wait for it
    ensureInit()
      .then(() => {
        middleware!(req, res, next);
      })
      .catch((err) => {
        console.error("[LoadFlux] Initialization failed:", err);
        next();
      });
  };
}

/**
 * Create LoadFlux Fastify plugin.
 *
 * @example
 * ```ts
 * import Fastify from "fastify";
 * import { loadfluxFastify } from "loadflux";
 *
 * const app = Fastify();
 * app.register(loadfluxFastify());
 * ```
 */
export function loadfluxFastify(userConfig?: LoadFluxConfig) {
  const resolvedConfig = resolveConfig({
    ...userConfig,
    framework: "fastify",
  });

  async function plugin(fastify: any) {
    const ctx = await createContext({
      ...userConfig,
      framework: "fastify",
    });
    const fastifyPlugin = createFastifyPlugin(ctx);
    await fastifyPlugin(fastify);
  }

  // Fastify plugin metadata
  (plugin as any)[Symbol.for("fastify.display-name")] = "loadflux";
  (plugin as any)[Symbol.for("skip-override")] = true;

  return plugin;
}

// Re-export types for consumers
export type { LoadFluxConfig, DatabaseAdapter } from "./types.js";
