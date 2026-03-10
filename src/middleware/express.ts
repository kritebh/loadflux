import type { Request, Response, NextFunction } from "express";
import type { MiddlewareContext } from "./types.js";
import { createApiHandler } from "../api/router.js";
import { createStaticHandler, tryServeAsset } from "../server/static.js";

export function createExpressMiddleware(ctx: MiddlewareContext) {
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

  return function loadfluxMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    const urlPath = req.path || req.url.split("?")[0];

    // Handle loadflux dashboard and API routes
    if (urlPath === basePath || urlPath.startsWith(basePath + "/")) {
      const subPath = urlPath.substring(basePath.length) || "/";

      if (subPath.startsWith("/api/")) {
        return apiHandler(req, res);
      }
      return staticHandler(req, res);
    }

    // Fallback: serve dashboard assets requested at /assets/* (handles
    // browsers that cached old HTML with relative paths)
    if (tryServeAsset(req, res)) return;

    // Skip excluded routes (exact matches and prefix patterns like "/docs/*")
    if (isExcluded(urlPath)) return next();

    // Intercept request for metrics
    const startTime = process.hrtime.bigint();

    res.on("finish", () => {
      try {
        const durationMs =
          Number(process.hrtime.bigint() - startTime) / 1_000_000;

        // Use route pattern if available, otherwise use the URL path
        const routePath =
          (req.route?.path
            ? (req.baseUrl || "") + req.route.path
            : urlPath) || "/";

        metricsStore.recordRequest({
          method: req.method,
          path: routePath,
          statusCode: res.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
          responseBytes: parseInt(res.getHeader("content-length") as string) || 0,
          timestamp: Date.now(),
        });
      } catch (err) {
        console.error("[LoadFlux] Failed to record request metrics:", err);
      }
    });

    next();
  };
}
