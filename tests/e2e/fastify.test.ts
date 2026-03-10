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
