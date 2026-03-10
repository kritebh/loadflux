import type { IncomingMessage, ServerResponse } from "http";
import type { MiddlewareContext } from "../middleware/types.js";
import type { TimeRange, TopEndpointMetric } from "../types.js";
import { isAuthenticated } from "../auth/middleware.js";
import {
  hashPassword,
  verifyPassword,
  createToken,
  setupInitialAuth,
} from "../auth/auth.js";

function isSecure(req: IncomingMessage): boolean {
  if ((req.socket as any).encrypted) return true;
  const proto = req.headers["x-forwarded-proto"];
  return proto === "https";
}

function buildCookieHeader(token: string, basePath: string, req: IncomingMessage, maxAge = 86400): string {
  let cookie = `__loadflux_token=${token}; Path=${basePath}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
  if (isSecure(req)) cookie += "; Secure";
  return cookie;
}

function parseUrl(req: IncomingMessage): { path: string; query: URLSearchParams } {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  return { path: url.pathname, query: url.searchParams };
}

function parseTimeRange(query: URLSearchParams): TimeRange {
  const now = Date.now();
  const from = parseInt(query.get("from") ?? "") || now - 60 * 60 * 1000; // default 1 hour
  const to = parseInt(query.get("to") ?? "") || now;
  return { from, to };
}

async function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
  });
}

function json(res: ServerResponse, data: any, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
  });
  res.end(JSON.stringify(data));
}

function notFound(res: ServerResponse): void {
  json(res, { error: "Not found" }, 404);
}

function unauthorized(res: ServerResponse): void {
  json(res, { error: "Unauthorized" }, 401);
}

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

interface LoginAttempt {
  count: number;
  firstAttempt: number;
}

const loginAttempts = new Map<string, LoginAttempt>();

function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function isRateLimited(ip: string): boolean {
  const attempt = loginAttempts.get(ip);
  if (!attempt) return false;

  // Reset if window has passed
  if (Date.now() - attempt.firstAttempt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(ip);
    return false;
  }

  return attempt.count >= LOGIN_MAX_ATTEMPTS;
}

function recordFailedLogin(ip: string): void {
  const attempt = loginAttempts.get(ip);
  if (!attempt || Date.now() - attempt.firstAttempt > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAttempt: Date.now() });
  } else {
    attempt.count++;
  }
}

function clearLoginAttempts(ip: string): void {
  loginAttempts.delete(ip);
}

export function createApiHandler(ctx: MiddlewareContext) {
  const { config, db, metricsStore } = ctx;
  const basePath = config.path;
  const sseClients = new Set<ServerResponse>();

  // Push SSE updates every 2 seconds
  let ssePending = false;
  const sseInterval = setInterval(async () => {
    if (sseClients.size === 0 || ssePending) return;
    ssePending = true;
    try {
      const snapshot = await metricsStore.getCurrentSnapshot(sseClients.size);
      const data = `data: ${JSON.stringify(snapshot)}\n\n`;
      for (const client of sseClients) {
        client.write(data);
      }
    } catch (err) {
      console.error("[LoadFlux] SSE snapshot push failed:", err);
    } finally {
      ssePending = false;
    }
  }, 2000);
  sseInterval.unref();

  return async function handleApi(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    // CORS preflight — no cross-origin access allowed (same-origin only)
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const { path: fullPath, query } = parseUrl(req);
    const apiPath = fullPath.substring(basePath.length + "/api".length);

    // Logout endpoint — always accessible, clears the auth cookie
    if (apiPath === "/logout" && req.method === "POST") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Set-Cookie": buildCookieHeader("", basePath, req, 0),
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    try {
      // Login endpoint — always accessible
      if (apiPath === "/login" && req.method === "POST") {
        const clientIp = getClientIp(req);
        if (isRateLimited(clientIp)) {
          return json(res, { error: "Too many login attempts. Try again later." }, 429);
        }

        const body = await readBody(req);
        const user = await db.getUser(body.username);
        if (!user) {
          recordFailedLogin(clientIp);
          return json(res, { error: "Invalid credentials" }, 401);
        }

        const valid = await verifyPassword(body.password, user.password_hash);
        if (!valid) {
          recordFailedLogin(clientIp);
          return json(res, { error: "Invalid credentials" }, 401);
        }

        clearLoginAttempts(clientIp);
        const token = await createToken(body.username, db);
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Set-Cookie": buildCookieHeader(token, basePath, req),
        });
        res.end(JSON.stringify({ token }));
        return;
      }

      // Auth check for all other endpoints
      const authed = await isAuthenticated(req, db);
      if (!authed) return unauthorized(res);

      // Check if auth is configured
      if (apiPath === "/auth/status") {
        const hasUsers = await db.getUser("admin");
        return json(res, { configured: !!hasUsers });
      }

      // SSE endpoint
      if (apiPath === "/sse") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
        return;
      }

      const range = parseTimeRange(query);

      // Routes
      switch (apiPath) {
        case "/system": {
          const data = await db.getSystemMetrics(range);
          return json(res, data);
        }
        case "/process": {
          const data = await db.getProcessMetrics(range);
          return json(res, data);
        }
        case "/endpoints": {
          const data = await db.getEndpointMetrics(range);
          return json(res, data);
        }
        case "/endpoints/top": {
          const metric = (query.get("metric") || "request_count") as TopEndpointMetric;
          const limit = parseInt(query.get("limit") ?? "10") || 10;
          const data = await db.getTopEndpoints(metric, limit, range);
          return json(res, data);
        }
        case "/endpoints/slow": {
          const threshold =
            parseInt(query.get("threshold") ?? "") ||
            config.slowRequestThreshold;
          const data = await db.getSlowRequests(threshold, range);
          return json(res, data);
        }
        case "/errors": {
          const data = await db.getErrorLog(range);
          return json(res, data);
        }
        case "/errors/distribution": {
          const data = await db.getStatusDistribution(range);
          return json(res, data);
        }
        case "/overview": {
          const data = await db.getOverview(range);
          return json(res, data);
        }
        case "/snapshot": {
          const data = await metricsStore.getCurrentSnapshot(sseClients.size);
          return json(res, data);
        }
        case "/export": {
          const [system, process, endpoints, errors] = await Promise.all([
            db.getSystemMetrics(range),
            db.getProcessMetrics(range),
            db.getEndpointMetrics(range),
            db.getErrorLog(range),
          ]);
          return json(res, { system, process, endpoints, errors });
        }
        case "/settings": {
          if (req.method === "POST") {
            const body = await readBody(req);
            if (body.retention_days !== undefined) {
              db.setSetting("retention_days", String(body.retention_days));
            }
            if (body.slow_threshold !== undefined) {
              db.setSetting("slow_threshold", String(body.slow_threshold));
            }
            return json(res, { ok: true });
          }
          const retentionDays =
            (await db.getSetting("retention_days")) ??
            String(config.retention.days);
          const slowThreshold =
            (await db.getSetting("slow_threshold")) ??
            String(config.slowRequestThreshold);
          return json(res, {
            retention_days: parseInt(retentionDays, 10),
            slow_threshold: parseInt(slowThreshold, 10),
          });
        }
        case "/auth/setup": {
          if (req.method !== "POST") return notFound(res);

          // Only allow setup when no users exist
          const existingUser = await db.getUser("admin");
          if (existingUser) {
            return json(res, { error: "Auth already configured. Use settings to change password." }, 403);
          }

          const body = await readBody(req);
          if (!body.username || !body.password) {
            return json(res, { error: "Username and password required" }, 400);
          }
          await setupInitialAuth(db, body.username, body.password);
          const token = await createToken(body.username, db);
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Set-Cookie": buildCookieHeader(token, basePath, req),
          });
          res.end(JSON.stringify({ ok: true, token }));
          return;
        }
        default:
          return notFound(res);
      }
    } catch (err) {
      console.error("[LoadFlux] API handler error:", err);
      if (!res.headersSent) {
        return json(res, { error: "Internal server error" }, 500);
      }
    }
  };
}
