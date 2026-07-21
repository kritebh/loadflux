import type { IncomingMessage, ServerResponse } from "http";
import type { MiddlewareContext } from "../middleware/types.js";
import type {
  TimeRange,
  TopEndpointMetric,
  PaginationParams,
  QueryFilter,
  MetricsQueryOptions,
} from "../types.js";
import { isAuthenticated } from "../auth/middleware.js";
import {
  verifyPassword,
  createToken,
  trySetupInitialUser,
} from "../auth/auth.js";
import { MAX_INSTANCE_ID_LENGTH } from "../db/constants.js";

const SSE_MAX_DRAIN_SKIPS = 5;
const SSE_MAX_BUFFER_BYTES = 1024 * 1024;
const EXPORT_SERIES_MAX_POINTS = 500;

function isSecure(req: IncomingMessage, trustProxy: boolean): boolean {
  if ((req.socket as any).encrypted) return true;
  if (!trustProxy) return false;
  const proto = req.headers["x-forwarded-proto"];
  return proto === "https";
}

function buildCookieHeader(
  token: string,
  basePath: string,
  req: IncomingMessage,
  trustProxy: boolean,
  maxAge = 86400,
): string {
  let cookie = `__loadflux_token=${token}; Path=${basePath}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
  if (isSecure(req, trustProxy)) cookie += "; Secure";
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

function parsePagination(query: URLSearchParams): PaginationParams | null {
  const pageStr = query.get("page");
  if (pageStr === null) return null;
  const page = Math.max(parseInt(pageStr, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.get("limit") ?? "200", 10) || 200, 1), 1000);
  return { page, limit };
}

function parseMaxPoints(query: URLSearchParams): number | undefined {
  const raw = query.get("max_points");
  if (!raw) return undefined;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 10) return undefined;
  return Math.min(parsed, 2000);
}

const MAX_JSON_BODY_BYTES = 32 * 1024;
const MAX_SSE_CLIENTS = 64;
const MAX_EXPORT_RANGE_MS = 31 * 24 * 60 * 60 * 1000;

type JsonBodyResult =
  | { ok: true; body: unknown }
  | { ok: false; status: 413 };

async function readJsonBody(
  req: IncomingMessage,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<JsonBodyResult> {
  return new Promise((resolve) => {
    const cl = req.headers["content-length"];
    if (cl) {
      const n = parseInt(cl, 10);
      if (Number.isFinite(n) && n > maxBytes) {
        resolve({ ok: false, status: 413 });
        return;
      }
    }
    let data = "";
    let size = 0;
    req.on("data", (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      size += buf.length;
      if (size > maxBytes) {
        req.destroy();
        resolve({ ok: false, status: 413 });
        return;
      }
      data += buf.toString("utf8");
    });
    req.on("end", () => {
      try {
        resolve({ ok: true, body: data ? JSON.parse(data) : {} });
      } catch {
        resolve({ ok: true, body: {} });
      }
    });
    req.on("error", () => resolve({ ok: true, body: {} }));
  });
}

/** Auto-sample wide ranges when the client omits max_points (keeps GROUP BY fast). */
const LONG_RANGE_AUTO_SAMPLE_MS = 5 * 24 * 60 * 60 * 1000; // 5 days
const LONG_RANGE_AUTO_MAX_POINTS = 900;

function resolveSeriesMaxPoints(
  query: URLSearchParams,
  range: TimeRange,
): number | undefined {
  const explicit = parseMaxPoints(query);
  if (explicit !== undefined) return explicit;
  if (range.to - range.from >= LONG_RANGE_AUTO_SAMPLE_MS) {
    return LONG_RANGE_AUTO_MAX_POINTS;
  }
  return undefined;
}

function parseMetricsQueryOptions(
  query: URLSearchParams,
  clusterEnabled: boolean,
): MetricsQueryOptions | undefined {
  const raw = query.get("instance")?.trim();
  if (raw) {
    const instanceId =
      raw.length > MAX_INSTANCE_ID_LENGTH
        ? raw.slice(0, MAX_INSTANCE_ID_LENGTH)
        : raw;
    return { instanceId };
  }
  if (clusterEnabled) {
    return { clusterAggregate: true };
  }
  return undefined;
}

function parseFilter(query: URLSearchParams): QueryFilter {
  const search = query.get("search")?.trim();
  const status = query.get("status")?.trim();
  if (!search && !status) return {};
  return { search, status };
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

function payloadTooLarge(res: ServerResponse): void {
  json(res, { error: "Payload too large" }, 413);
}

function badRequest(res: ServerResponse, message: string): void {
  json(res, { error: message }, 400);
}

function parseSettingsInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n) && Number.isInteger(n)) return n;
  }
  return null;
}

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

interface LoginAttempt {
  count: number;
  firstAttempt: number;
}

const loginAttempts = new Map<string, LoginAttempt>();

/** @internal Clears login rate-limit state (for tests). */
export function resetLoginAttemptsForTests(): void {
  loginAttempts.clear();
}

function getClientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string") {
      const first = forwarded.split(",")[0]?.trim();
      if (first) return first;
    }
  }
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

function pruneStaleLoginAttempts(): void {
  if (loginAttempts.size <= 1000) return;
  const now = Date.now();
  for (const [ip, attempt] of loginAttempts) {
    if (now - attempt.firstAttempt > LOGIN_WINDOW_MS) {
      loginAttempts.delete(ip);
    }
  }
}

function recordFailedLogin(ip: string): void {
  const attempt = loginAttempts.get(ip);
  if (!attempt || Date.now() - attempt.firstAttempt > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAttempt: Date.now() });
  } else {
    attempt.count++;
  }
  pruneStaleLoginAttempts();
}

function clearLoginAttempts(ip: string): void {
  loginAttempts.delete(ip);
  pruneStaleLoginAttempts();
}

export function createApiHandler(ctx: MiddlewareContext) {
  const { config, db, metricsStore } = ctx;
  const basePath = config.path;
  const trustProxy = config.trustProxy;
  const sseClients = new Set<ServerResponse>();
  const sseWaitingDrain = new WeakSet<ServerResponse>();
  const sseDrainSkips = new WeakMap<ServerResponse, number>();

  const dropSseClient = (client: ServerResponse) => {
    sseClients.delete(client);
    sseWaitingDrain.delete(client);
    sseDrainSkips.delete(client);
    try {
      if (!client.writableEnded && !client.destroyed) client.destroy();
    } catch {
      // ignore
    }
  };

  // Push SSE updates every 2 seconds
  let ssePending = false;
  const sseInterval = setInterval(async () => {
    if (sseClients.size === 0 || ssePending) return;
    ssePending = true;
    try {
      // Drop half-closed sockets left behind by proxies / browser reconnects
      for (const client of sseClients) {
        if (client.writableEnded || client.destroyed) {
          dropSseClient(client);
        }
      }
      if (sseClients.size === 0) return;

      const snapshot = await metricsStore.getCurrentSnapshot(sseClients.size);
      const data = `data: ${JSON.stringify(snapshot)}\n\n`;
      for (const client of sseClients) {
        try {
          if (client.writableEnded || client.destroyed) {
            dropSseClient(client);
            continue;
          }
          if (sseWaitingDrain.has(client)) {
            const skips = (sseDrainSkips.get(client) ?? 0) + 1;
            sseDrainSkips.set(client, skips);
            const buffered =
              typeof client.writableLength === "number"
                ? client.writableLength
                : 0;
            if (skips >= SSE_MAX_DRAIN_SKIPS || buffered > SSE_MAX_BUFFER_BYTES) {
              dropSseClient(client);
            }
            continue;
          }
          const ok = client.write(data);
          if (!ok) {
            sseWaitingDrain.add(client);
            sseDrainSkips.set(client, 0);
            client.once("drain", () => {
              sseWaitingDrain.delete(client);
              sseDrainSkips.delete(client);
            });
          }
        } catch {
          dropSseClient(client);
        }
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
        "Set-Cookie": buildCookieHeader("", basePath, req, trustProxy, 0),
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    try {
      // Login endpoint — always accessible
      if (apiPath === "/login" && req.method === "POST") {
        const clientIp = getClientIp(req, trustProxy);
        if (isRateLimited(clientIp)) {
          return json(res, { error: "Too many login attempts. Try again later." }, 429);
        }

        const parsed = await readJsonBody(req);
        if (!parsed.ok) return payloadTooLarge(res);
        const body = parsed.body as { username?: string; password?: string };
        const user = await db.getUser(String(body.username ?? ""));
        if (!user) {
          recordFailedLogin(clientIp);
          return json(res, { error: "Invalid credentials" }, 401);
        }

        const valid = await verifyPassword(String(body.password ?? ""), user.password_hash);
        if (!valid) {
          recordFailedLogin(clientIp);
          return json(res, { error: "Invalid credentials" }, 401);
        }

        clearLoginAttempts(clientIp);
        const token = await createToken(String(body.username), db);
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Set-Cookie": buildCookieHeader(token, basePath, req, trustProxy),
        });
        res.end(JSON.stringify({ token }));
        return;
      }

      // Public: lets SPA distinguish setup vs login vs logged-in dashboard
      if (apiPath === "/auth/status") {
        const configured = await db.hasAnyUser();
        const authenticated =
          configured &&
          (await isAuthenticated(req, db, { configured: true }));
        return json(res, { configured, authenticated });
      }

      const anyUser = await db.hasAnyUser();
      if (!anyUser) {
        if (apiPath === "/auth/setup" && req.method === "POST") {
          const clientIp = getClientIp(req, trustProxy);
          if (isRateLimited(clientIp)) {
            return json(res, { error: "Too many setup attempts. Try again later." }, 429);
          }

          const parsed = await readJsonBody(req);
          if (!parsed.ok) return payloadTooLarge(res);
          const body = parsed.body as { username?: string; password?: string };
          if (!body.username || !body.password) {
            return json(res, { error: "Username and password required" }, 400);
          }

          const result = await trySetupInitialUser(
            db,
            String(body.username),
            String(body.password),
          );
          if (result === "already_configured") {
            return json(res, { error: "Auth already configured" }, 409);
          }
          if (result === "failed") {
            recordFailedLogin(clientIp);
            return json(res, { error: "Failed to configure auth" }, 500);
          }

          clearLoginAttempts(clientIp);
          const token = await createToken(String(body.username), db);
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Set-Cookie": buildCookieHeader(token, basePath, req, trustProxy),
          });
          res.end(JSON.stringify({ ok: true, token }));
          return;
        }
        return unauthorized(res);
      }

      const authed = await isAuthenticated(req, db, { configured: true });
      if (!authed) return unauthorized(res);

      // SSE endpoint
      if (apiPath === "/sse") {
        if (sseClients.size >= MAX_SSE_CLIENTS) {
          return json(res, { error: "Too many live connections" }, 503);
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        sseClients.add(res);
        const remove = () => {
          sseClients.delete(res);
          sseWaitingDrain.delete(res);
          sseDrainSkips.delete(res);
        };
        req.on("close", remove);
        req.on("aborted", remove);
        res.on("close", remove);
        res.on("error", remove);
        return;
      }

      const range = parseTimeRange(query);
      const seriesMaxPoints = resolveSeriesMaxPoints(query, range);
      const filter = parseFilter(query);
      const metricsOptions = parseMetricsQueryOptions(
        query,
        config.cluster.enabled,
      );

      // Routes
      switch (apiPath) {
        case "/instances": {
          const instances = await db.listInstances(range);
          return json(res, { instances });
        }
        case "/system": {
          const pg = parsePagination(query);
          if (pg) {
            const result = await db.getSystemMetricsPaginated(
              range,
              pg,
              seriesMaxPoints,
              metricsOptions,
            );
            return json(res, result);
          }
          const data = await db.getSystemMetrics(
            range,
            seriesMaxPoints,
            metricsOptions,
          );
          return json(res, data);
        }
        case "/process": {
          const pg = parsePagination(query);
          if (pg) {
            const result = await db.getProcessMetricsPaginated(
              range,
              pg,
              seriesMaxPoints,
              metricsOptions,
            );
            return json(res, result);
          }
          const data = await db.getProcessMetrics(
            range,
            seriesMaxPoints,
            metricsOptions,
          );
          return json(res, data);
        }
        case "/endpoints": {
          const pg = parsePagination(query);
          if (pg) {
            const result = await db.getEndpointMetricsPaginated(range, pg, filter);
            return json(res, result);
          }
          const data = await db.getEndpointMetrics(range, filter);
          return json(res, data);
        }
        case "/endpoints/top": {
          const metric = (query.get("metric") || "request_count") as TopEndpointMetric;
          const limit = parseInt(query.get("limit") ?? "10") || 10;
          const data = await db.getTopEndpoints(metric, limit, range, filter);
          return json(res, data);
        }
        case "/endpoints/slow": {
          const threshold =
            parseInt(query.get("threshold") ?? "") ||
            config.slowRequestThreshold;
          const pg = parsePagination(query);
          if (pg) {
            const result = await db.getSlowRequestsPaginated(threshold, range, pg, filter);
            return json(res, result);
          }
          const data = await db.getSlowRequests(threshold, range, filter);
          return json(res, data);
        }
        case "/errors": {
          const pg = parsePagination(query);
          if (pg) {
            const result = await db.getErrorLogPaginated(range, pg, filter);
            return json(res, result);
          }
          const data = await db.getErrorLog(range, filter);
          return json(res, data);
        }
        case "/errors/status-codes": {
          const codes = await db.getErrorStatusCodes(range);
          return json(res, { codes });
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
          if (range.to - range.from > MAX_EXPORT_RANGE_MS) {
            return json(
              res,
              { error: "Export time range too large (max 31 days)" },
              400,
            );
          }
          const [system, process, endpoints, errors] = await Promise.all([
            db.getSystemMetrics(
              range,
              EXPORT_SERIES_MAX_POINTS,
              config.cluster.enabled ? { clusterAggregate: true } : undefined,
            ),
            db.getProcessMetrics(
              range,
              EXPORT_SERIES_MAX_POINTS,
              config.cluster.enabled ? { clusterAggregate: true } : undefined,
            ),
            db.getEndpointMetrics(range),
            db.getErrorLog(range),
          ]);
          return json(res, { system, process, endpoints, errors });
        }
        case "/settings": {
          if (req.method === "POST") {
            const parsed = await readJsonBody(req);
            if (!parsed.ok) return payloadTooLarge(res);
            const body = parsed.body as {
              retention_days?: unknown;
              slow_threshold?: unknown;
            };
            if (body.retention_days !== undefined) {
              const days = parseSettingsInt(body.retention_days);
              if (days === null || days < 1) {
                return badRequest(
                  res,
                  "retention_days must be an integer >= 1",
                );
              }
              db.setSetting("retention_days", String(days));
            }
            if (body.slow_threshold !== undefined) {
              const threshold = parseSettingsInt(body.slow_threshold);
              if (threshold === null || threshold < 0) {
                return badRequest(
                  res,
                  "slow_threshold must be an integer >= 0",
                );
              }
              db.setSetting("slow_threshold", String(threshold));
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
          return json(
            res,
            {
              error:
                "Auth already configured. Use settings to change password.",
            },
            403,
          );
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
