import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "http";
import { loadflux } from "../../src/index.js";
import path from "path";
import os from "os";
import fs from "fs";

const TEST_PORT = 9871;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const DB_PATH = path.join(os.tmpdir(), `loadflux-e2e-express-${Date.now()}.db`);

let server: http.Server;

describe("Express E2E", () => {
  beforeAll(async () => {
    const app = express();

    app.use(
      loadflux({
        path: "/loadflux",
        auth: { username: "admin", password: "testpass" },
        database: { adapter: "sqlite", connectionString: DB_PATH },
        collection: { systemInterval: 1000, aggregationWindow: 1000 },
        excludeRoutes: ["/documentation/*"],
      })
    );

    app.get("/api/hello", (_req, res) => {
      res.json({ message: "hello" });
    });

    app.get("/api/slow", (_req, res) => {
      setTimeout(() => res.json({ message: "slow" }), 100);
    });

    app.get("/api/error", (_req, res) => {
      res.status(500).json({ error: "fail" });
    });

    app.get("/documentation/guide", (_req, res) => {
      res.json({ ok: true });
    });

    await new Promise<void>((resolve) => {
      server = app.listen(TEST_PORT, "127.0.0.1", () => resolve());
    });

    // Wait for loadflux to finish async init
    await new Promise((r) => setTimeout(r, 1500));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const suffix of ["", "-wal", "-shm"]) {
      try { fs.unlinkSync(DB_PATH + suffix); } catch {}
    }
  });

  async function loginAndGetToken(): Promise<string> {
    const res = await fetch(`${BASE_URL}/loadflux/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "testpass" }),
    });
    const data = await res.json();
    return data.token;
  }

  function authHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  it("serves dashboard HTML at /loadflux", async () => {
    const token = await loginAndGetToken();
    const res = await fetch(`${BASE_URL}/loadflux`, {
      headers: authHeaders(token),
    });
    // Should return HTML (200) or at least not 404
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      const text = await res.text();
      expect(text).toContain("html");
    }
  });

  it("login returns a token", async () => {
    const res = await fetch(`${BASE_URL}/loadflux/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "testpass" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.token).toBeDefined();
    expect(data.token.length).toBeGreaterThan(10);
  });

  it("rejects invalid login", async () => {
    const res = await fetch(`${BASE_URL}/loadflux/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "wrong" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects unauthenticated API requests", async () => {
    const res = await fetch(`${BASE_URL}/loadflux/api/system`);
    expect(res.status).toBe(401);
  });

  it("auth/status is public and reports configured vs authenticated", async () => {
    const res = await fetch(`${BASE_URL}/loadflux/api/auth/status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.configured).toBe(true);
    expect(data.authenticated).toBe(false);

    const token = await loginAndGetToken();
    const res2 = await fetch(`${BASE_URL}/loadflux/api/auth/status`, {
      headers: authHeaders(token),
    });
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.configured).toBe(true);
    expect(data2.authenticated).toBe(true);
  });

  it("returns system metrics", async () => {
    const token = await loginAndGetToken();
    const now = Date.now();
    const res = await fetch(
      `${BASE_URL}/loadflux/api/system?from=${now - 60000}&to=${now + 1000}`,
      { headers: authHeaders(token) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("returns process metrics", async () => {
    const token = await loginAndGetToken();
    const now = Date.now();
    const res = await fetch(
      `${BASE_URL}/loadflux/api/process?from=${now - 60000}&to=${now + 1000}`,
      { headers: authHeaders(token) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("supports server-side sampling for system metrics", async () => {
    const token = await loginAndGetToken();
    await new Promise((r) => setTimeout(r, 2500));

    const now = Date.now();
    const res = await fetch(
      `${BASE_URL}/loadflux/api/system?from=${now - 600000}&to=${now + 1000}&max_points=10`,
      { headers: authHeaders(token) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeLessThanOrEqual(10);
  });

  it("auto-samples system metrics for wide ranges when max_points is omitted", async () => {
    const token = await loginAndGetToken();
    const now = Date.now();
    const res = await fetch(
      `${BASE_URL}/loadflux/api/system?from=${now - 8 * 24 * 60 * 60 * 1000}&to=${now + 1000}`,
      { headers: authHeaders(token) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeLessThanOrEqual(900);
  });

  it("records and returns endpoint metrics after traffic", async () => {
    const token = await loginAndGetToken();

    // Generate some traffic
    await fetch(`${BASE_URL}/api/hello`);
    await fetch(`${BASE_URL}/api/hello`);
    await fetch(`${BASE_URL}/api/error`);

    // Wait for aggregator flush
    await new Promise((r) => setTimeout(r, 2000));

    const now = Date.now();
    const res = await fetch(
      `${BASE_URL}/loadflux/api/endpoints?from=${now - 60000}&to=${now + 1000}`,
      { headers: authHeaders(token) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it("filters endpoint and error APIs by search query", async () => {
    const token = await loginAndGetToken();

    await fetch(`${BASE_URL}/api/hello`);
    await fetch(`${BASE_URL}/api/error`);
    await new Promise((r) => setTimeout(r, 2000));

    const now = Date.now();
    const endpointRes = await fetch(
      `${BASE_URL}/loadflux/api/endpoints?from=${now - 60000}&to=${now + 1000}&page=1&limit=100&search=error`,
      { headers: authHeaders(token) }
    );
    expect(endpointRes.status).toBe(200);
    const endpointData = await endpointRes.json();
    expect(Array.isArray(endpointData.data)).toBe(true);
    expect(endpointData.data.length).toBeGreaterThan(0);
    expect(endpointData.data.every((r: any) => `${r.method} ${r.path}`.toLowerCase().includes("error"))).toBe(true);

    const errorRes = await fetch(
      `${BASE_URL}/loadflux/api/errors?from=${now - 60000}&to=${now + 1000}&page=1&limit=100&search=error`,
      { headers: authHeaders(token) }
    );
    expect(errorRes.status).toBe(200);
    const errorData = await errorRes.json();
    expect(Array.isArray(errorData.data)).toBe(true);
    expect(errorData.data.length).toBeGreaterThan(0);
    expect(errorData.data.every((r: any) => `${r.method} ${r.path}`.toLowerCase().includes("error"))).toBe(true);

    const statusRes = await fetch(
      `${BASE_URL}/loadflux/api/errors?from=${now - 60000}&to=${now + 1000}&page=1&limit=100&status=5xx`,
      { headers: authHeaders(token) }
    );
    expect(statusRes.status).toBe(200);
    const statusData = await statusRes.json();
    expect(Array.isArray(statusData.data)).toBe(true);
    expect(statusData.data.length).toBeGreaterThan(0);
    expect(statusData.data.every((r: any) => r.status_code >= 500 && r.status_code <= 599)).toBe(true);

    const codesRes = await fetch(
      `${BASE_URL}/loadflux/api/errors/status-codes?from=${now - 60000}&to=${now + 1000}`,
      { headers: authHeaders(token) }
    );
    expect(codesRes.status).toBe(200);
    const codesBody = await codesRes.json();
    expect(Array.isArray(codesBody.codes)).toBe(true);
    expect(codesBody.codes).toContain(500);
  });

  it("returns snapshot", async () => {
    const token = await loginAndGetToken();
    const res = await fetch(`${BASE_URL}/loadflux/api/snapshot`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.system).toBeDefined();
    expect(data.process).toBeDefined();
    expect(data.overview).toBeDefined();
    expect(data.endpoints).toBeDefined();
    expect(data.server).toBeDefined();
    expect(data.server.node_version).toContain("v");
    expect(data.server.pid).toBeGreaterThan(0);
    expect(data.overview.p95_duration).toBeDefined();
    expect(data.overview.p99_duration).toBeDefined();
  });

  it("returns overview with p95/p99", async () => {
    const token = await loginAndGetToken();
    const now = Date.now();
    const res = await fetch(
      `${BASE_URL}/loadflux/api/overview?from=${now - 60000}&to=${now + 1000}`,
      { headers: authHeaders(token) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total_requests).toBeDefined();
    expect(data.p95_duration).toBeDefined();
    expect(data.p99_duration).toBeDefined();
  });

  it("returns settings", async () => {
    const token = await loginAndGetToken();
    const res = await fetch(`${BASE_URL}/loadflux/api/settings`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.retention_days).toBe(90);
    expect(data.slow_threshold).toBe(500);
  });

  it("updates settings", async () => {
    const token = await loginAndGetToken();
    const res = await fetch(`${BASE_URL}/loadflux/api/settings`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ retention_days: 30 }),
    });
    expect(res.status).toBe(200);

    const res2 = await fetch(`${BASE_URL}/loadflux/api/settings`, {
      headers: authHeaders(token),
    });
    const data = await res2.json();
    expect(data.retention_days).toBe(30);
  });

  it("exports data as JSON", async () => {
    const token = await loginAndGetToken();
    const now = Date.now();
    const res = await fetch(
      `${BASE_URL}/loadflux/api/export?from=${now - 60000}&to=${now + 1000}`,
      { headers: authHeaders(token) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.system).toBeDefined();
    expect(data.process).toBeDefined();
    expect(data.endpoints).toBeDefined();
    expect(data.errors).toBeDefined();
  });

  it("tracks app routes and excludes loadflux routes from metrics", async () => {
    const token = await loginAndGetToken();

    // Hit an app route
    await fetch(`${BASE_URL}/api/hello`);
    await new Promise((r) => setTimeout(r, 2000));

    const now = Date.now();
    const res = await fetch(
      `${BASE_URL}/loadflux/api/endpoints?from=${now - 60000}&to=${now + 1000}`,
      { headers: authHeaders(token) }
    );
    const data = await res.json();

    // Should have /api/hello but NOT /loadflux/* routes
    const paths = data.map((r: any) => r.path);
    const hasLoadfluxRoute = paths.some((p: string) => p.startsWith("/loadflux"));
    expect(hasLoadfluxRoute).toBe(false);
  });

  it("respects prefix patterns in excludeRoutes", async () => {
    const token = await loginAndGetToken();

    // Hit an excluded documentation route and a normal API route
    await fetch(`${BASE_URL}/documentation/guide`);
    await fetch(`${BASE_URL}/api/hello`);

    // Wait for aggregator flush
    await new Promise((r) => setTimeout(r, 2000));

    const now = Date.now();
    const res = await fetch(
      `${BASE_URL}/loadflux/api/endpoints?from=${now - 60000}&to=${now + 1000}`,
      { headers: authHeaders(token) }
    );
    const data = await res.json();
    const paths = data.map((r: any) => r.path);

    // /api/hello should be present, /documentation/guide should be excluded
    expect(paths).toContain("/api/hello");
    const hasDocumentation = paths.some((p: string) =>
      p.startsWith("/documentation")
    );
    expect(hasDocumentation).toBe(false);
  });

  it("authenticates via session cookie without Bearer header", async () => {
    const loginRes = await fetch(`${BASE_URL}/loadflux/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "testpass" }),
    });
    const { token } = await loginRes.json();
    const now = Date.now();
    const res = await fetch(
      `${BASE_URL}/loadflux/api/system?from=${now - 60000}&to=${now + 1000}`,
      { headers: { Cookie: `__loadflux_token=${token}` } },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("rejects invalid retention_days in settings POST", async () => {
    const token = await loginAndGetToken();
    const res = await fetch(`${BASE_URL}/loadflux/api/settings`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ retention_days: 0 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("retention_days");
  });

  it("rejects export range wider than 31 days", async () => {
    const token = await loginAndGetToken();
    const now = Date.now();
    const from = now - 32 * 24 * 60 * 60 * 1000;
    const res = await fetch(
      `${BASE_URL}/loadflux/api/export?from=${from}&to=${now + 1000}`,
      { headers: authHeaders(token) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/31 days/i);
  });

  it("rejects oversized JSON body on login", async () => {
    const huge = JSON.stringify({
      username: "admin",
      password: "x".repeat(40_000),
    });
    const res = await fetch(`${BASE_URL}/loadflux/api/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(huge)),
      },
      body: huge,
    });
    expect(res.status).toBe(413);
  });
});
