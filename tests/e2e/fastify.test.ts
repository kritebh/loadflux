import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import { loadfluxFastify } from "../../src/index.js";
import path from "path";
import os from "os";
import fs from "fs";

const TEST_PORT = 9872;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const DB_PATH = path.join(os.tmpdir(), `loadflux-e2e-fastify-${Date.now()}.db`);

let app: ReturnType<typeof Fastify>;

describe("Fastify E2E", () => {
  beforeAll(async () => {
    app = Fastify();

    await app.register(
      loadfluxFastify({
        path: "/loadflux",
        auth: { username: "admin", password: "testpass" },
        database: { adapter: "sqlite", connectionString: DB_PATH },
        collection: { systemInterval: 1000, aggregationWindow: 1000 },
        excludeRoutes: ["/documentation/*"],
      })
    );

    app.get("/api/hello", async () => {
      return { message: "hello" };
    });

    app.get("/api/error", async (_req, reply) => {
      reply.code(500);
      return { error: "fail" };
    });

    app.get("/documentation/guide", async () => {
      return { ok: true };
    });

    await app.listen({ port: TEST_PORT, host: "127.0.0.1" });

    // Wait for metrics collection to start
    await new Promise((r) => setTimeout(r, 1500));
  });

  afterAll(async () => {
    await app.close();
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

  it("login returns a token", async () => {
    const res = await fetch(`${BASE_URL}/loadflux/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "testpass" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.token).toBeDefined();
  });

  it("rejects unauthenticated requests", async () => {
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
    const data2 = await res2.json();
    expect(data2.authenticated).toBe(true);
  });

  it("returns and updates settings", async () => {
    const token = await loginAndGetToken();
    const getRes = await fetch(`${BASE_URL}/loadflux/api/settings`, {
      headers: authHeaders(token),
    });
    expect(getRes.status).toBe(200);
    const settings = await getRes.json();
    expect(settings.retention_days).toBe(90);

    const postRes = await fetch(`${BASE_URL}/loadflux/api/settings`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ slow_threshold: 750 }),
    });
    expect(postRes.status).toBe(200);

    const getRes2 = await fetch(`${BASE_URL}/loadflux/api/settings`, {
      headers: authHeaders(token),
    });
    const updated = await getRes2.json();
    expect(updated.slow_threshold).toBe(750);
  });

  it("filters errors by search and status", async () => {
    const token = await loginAndGetToken();
    await fetch(`${BASE_URL}/api/hello`);
    await fetch(`${BASE_URL}/api/error`);
    await new Promise((r) => setTimeout(r, 2000));

    const now = Date.now();
    const errorRes = await fetch(
      `${BASE_URL}/loadflux/api/errors?from=${now - 60000}&to=${now + 1000}&page=1&limit=100&search=error`,
      { headers: authHeaders(token) },
    );
    expect(errorRes.status).toBe(200);
    const errorData = await errorRes.json();
    expect(errorData.data.length).toBeGreaterThan(0);
    expect(
      errorData.data.every((r: { path: string }) =>
        r.path.toLowerCase().includes("error"),
      ),
    ).toBe(true);

    const statusRes = await fetch(
      `${BASE_URL}/loadflux/api/errors?from=${now - 60000}&to=${now + 1000}&page=1&limit=100&status=5xx`,
      { headers: authHeaders(token) },
    );
    const statusData = await statusRes.json();
    expect(
      statusData.data.every(
        (r: { status_code: number }) => r.status_code >= 500,
      ),
    ).toBe(true);
  });

  it("returns snapshot with server info", async () => {
    const token = await loginAndGetToken();
    const res = await fetch(`${BASE_URL}/loadflux/api/snapshot`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.system).toBeDefined();
    expect(data.process).toBeDefined();
    expect(data.server).toBeDefined();
    expect(data.server.node_version).toContain("v");
    expect(data.server.platform).toBeDefined();
  });

  it("records app route metrics", async () => {
    const token = await loginAndGetToken();

    // Generate traffic
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
    expect(data.length).toBeGreaterThan(0);
  });

  it("returns status distribution", async () => {
    const token = await loginAndGetToken();
    const now = Date.now();
    const res = await fetch(
      `${BASE_URL}/loadflux/api/errors/distribution?from=${now - 60000}&to=${now + 1000}`,
      { headers: authHeaders(token) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status_2xx).toBeDefined();
    expect(data.status_5xx).toBeDefined();
  });

  it("excludes loadflux routes from metrics", async () => {
    const token = await loginAndGetToken();

    await fetch(`${BASE_URL}/api/hello`);
    await new Promise((r) => setTimeout(r, 2000));

    const now = Date.now();
    const res = await fetch(
      `${BASE_URL}/loadflux/api/endpoints?from=${now - 60000}&to=${now + 1000}`,
      { headers: authHeaders(token) }
    );
    const data = await res.json();
    const paths = data.map((r: any) => r.path);
    const hasLoadfluxRoute = paths.some((p: string) => p.startsWith("/loadflux"));
    expect(hasLoadfluxRoute).toBe(false);
  });

  it("respects prefix patterns in excludeRoutes", async () => {
    const token = await loginAndGetToken();

    await fetch(`${BASE_URL}/documentation/guide`);
    await fetch(`${BASE_URL}/api/hello`);
    await new Promise((r) => setTimeout(r, 2000));

    const now = Date.now();
    const res = await fetch(
      `${BASE_URL}/loadflux/api/endpoints?from=${now - 60000}&to=${now + 1000}`,
      { headers: authHeaders(token) }
    );
    const data = await res.json();
    const paths = data.map((r: any) => r.path);

    expect(paths).toContain("/api/hello");
    const hasDocumentation = paths.some((p: string) =>
      p.startsWith("/documentation")
    );
    expect(hasDocumentation).toBe(false);
  });
});
