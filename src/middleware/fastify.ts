import type { MiddlewareContext } from "./types.js";
import { createApiHandler } from "../api/router.js";
import { createStaticHandler } from "../server/static.js";

export function createFastifyPlugin(ctx: MiddlewareContext) {
  const { config, metricsStore } = ctx;
  const basePath = config.path;
  const apiHandler = createApiHandler(ctx);
  const staticHandler = createStaticHandler(basePath);
  const excludeSet = new Set(config.excludeRoutes);
  const excludePrefixes = config.excludeRoutes
    .filter((route) => route.endsWith("*"))
    .map((route) => route.replace(/\/\*+$/, ""));

  const isExcluded = (path: string): boolean => {
    if (excludeSet.has(path)) return true;
    return excludePrefixes.some((prefix) => path === prefix || path.startsWith(prefix + "/"));
  };

  async function loadfluxPlugin(fastify: any) {
    // Register loadflux routes in an encapsulated context so we can
    // disable body parsing — the raw apiHandler reads from the stream itself.
    fastify.register(async function loadfluxRoutes(instance: any) {
      instance.removeAllContentTypeParsers();
      instance.addContentTypeParser(
        "*",
        (_req: any, _payload: any, done: any) => done(null)
      );

      instance.all(`${basePath}`, (req: any, reply: any) => {
        reply.hijack();
        return staticHandler(req.raw, reply.raw);
      });

      instance.all(`${basePath}/*`, (req: any, reply: any) => {
        const urlPath = req.url.split("?")[0];
        const subPath = urlPath.substring(basePath.length) || "/";

        if (subPath.startsWith("/api/")) {
          reply.hijack();
          return apiHandler(req.raw, reply.raw);
        }
        reply.hijack();
        return staticHandler(req.raw, reply.raw);
      });
    });

    // Hook into every request for metrics collection
    fastify.addHook("onResponse", (req: any, reply: any, done: () => void) => {
      try {
        const urlPath = req.url.split("?")[0];

        // Skip loadflux routes and excluded routes
        if (urlPath.startsWith(basePath) || isExcluded(urlPath)) {
          return done();
        }

        const durationMs = reply.elapsedTime; // Fastify provides this
        const routePath = req.routeOptions?.url || req.routerPath || urlPath;

        metricsStore.recordRequest({
          method: req.method,
          path: routePath,
          statusCode: reply.statusCode,
          durationMs: Math.round((durationMs || 0) * 100) / 100,
          responseBytes:
            parseInt(reply.getHeader("content-length") as string) || 0,
          timestamp: Date.now(),
        });
      } catch (err) {
        console.error("[LoadFlux] Failed to record request metrics:", err);
      }

      done();
    });
  }

  // Mark as a Fastify plugin
  (loadfluxPlugin as any)[Symbol.for("fastify.display-name")] = "loadflux";
  (loadfluxPlugin as any)[Symbol.for("skip-override")] = true;

  return loadfluxPlugin;
}
