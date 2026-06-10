import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "http";
import { loadflux } from "../../src/index.js";
import { resetLoginAttemptsForTests } from "../../src/api/router.js";
import path from "path";
import os from "os";
import fs from "fs";

const SETUP_PORT = 9873;
const DISABLED_PORT = 9874;
const RATE_LIMIT_PORT = 9875;

const SETUP_DB = path.join(
  os.tmpdir(),
  `loadflux-e2e-setup-${Date.now()}.db`,
);
const RATE_LIMIT_DB = path.join(
  os.tmpdir(),
  `loadflux-e2e-rate-${Date.now()}.db`,
);

let setupServer: http.Server;
let disabledServer: http.Server;
let rateLimitServer: http.Server;

describe("Security E2E", () => {
  beforeAll(async () => {
    const setupApp = express();
    setupApp.use(
      loadflux({
        path: "/loadflux",
        database: { adapter: "sqlite", connectionString: SETUP_DB },
        collection: { systemInterval: 5000, aggregationWindow: 5000 },
      }),
    );
    await new Promise<void>((resolve) => {
      setupServer = setupApp.listen(SETUP_PORT, "127.0.0.1", () => resolve());
    });

    const disabledApp = express();
    disabledApp.use(
      loadflux({
        path: "/loadflux",
        disableOnLocalhost: true,
        listenHost: "127.0.0.1",
        auth: { username: "admin", password: "testpass" },
      }),
    );
    disabledApp.get("/api/hello", (_req, res) => {
      res.json({ ok: true });
    });
    await new Promise<void>((resolve) => {
      disabledServer = disabledApp.listen(DISABLED_PORT, "127.0.0.1", () =>
        resolve(),
      );
    });

    const rateApp = express();
    rateApp.use(
      loadflux({
        path: "/loadflux",
        trustProxy: false,
        auth: { username: "admin", password: "testpass" },
        database: { adapter: "sqlite", connectionString: RATE_LIMIT_DB },
        collection: { systemInterval: 5000, aggregationWindow: 5000 },
      }),
    );
    await new Promise<void>((resolve) => {
      rateLimitServer = rateApp.listen(RATE_LIMIT_PORT, "127.0.0.1", () =>
        resolve(),
      );
    });

    await new Promise((r) => setTimeout(r, 1500));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => setupServer?.close(() => resolve()));
    await new Promise<void>((resolve) => disabledServer?.close(() => resolve()));
    await new Promise<void>((resolve) =>
      rateLimitServer?.close(() => resolve()),
    );
    for (const dbPath of [SETUP_DB, RATE_LIMIT_DB]) {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          fs.unlinkSync(dbPath + suffix);
        } catch {}
      }
    }
  });

  describe("first-time auth setup", () => {
    const base = `http://127.0.0.1:${SETUP_PORT}/loadflux/api`;

    it("creates admin via POST /auth/setup when no users exist", async () => {
      const statusRes = await fetch(`${base}/auth/status`);
      expect(statusRes.status).toBe(200);
      const status = await statusRes.json();
      expect(status.configured).toBe(false);

      const setupRes = await fetch(`${base}/auth/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "setupadmin", password: "setuppass" }),
      });
      expect(setupRes.status).toBe(200);
      const setupBody = await setupRes.json();
      expect(setupBody.ok).toBe(true);
      expect(setupBody.token).toBeDefined();

      const authedRes = await fetch(`${base}/auth/status`, {
        headers: { Authorization: `Bearer ${setupBody.token}` },
      });
      const authed = await authedRes.json();
      expect(authed.configured).toBe(true);
      expect(authed.authenticated).toBe(true);
    });

    it("rejects further setup when auth is already configured", async () => {
      const unauthed = await fetch(`${base}/auth/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "other", password: "otherpass" }),
      });
      expect(unauthed.status).toBe(401);

      const loginRes = await fetch(`${base}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "setupadmin",
          password: "setuppass",
        }),
      });
      const { token } = await loginRes.json();
      const authed = await fetch(`${base}/auth/setup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username: "other", password: "otherpass" }),
      });
      expect(authed.status).toBe(403);
    });
  });

  describe("disableOnLocalhost", () => {
    const base = `http://127.0.0.1:${DISABLED_PORT}`;

    it("does not mount LoadFlux API on loopback bind", async () => {
      const res = await fetch(`${base}/loadflux/api/auth/status`);
      expect(res.status).toBe(404);
    });

    it("still serves application routes", async () => {
      const res = await fetch(`${base}/api/hello`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });
  });

  describe("login rate limiting", () => {
    const base = `http://127.0.0.1:${RATE_LIMIT_PORT}/loadflux/api`;

    beforeEach(() => {
      resetLoginAttemptsForTests();
    });

    it("returns 429 after five failed login attempts", async () => {
      for (let i = 0; i < 5; i++) {
        const res = await fetch(`${base}/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "admin", password: "wrong" }),
        });
        expect(res.status).toBe(401);
      }

      const blocked = await fetch(`${base}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "wrong" }),
      });
      expect(blocked.status).toBe(429);
    });

    it("ignores X-Forwarded-For when trustProxy is false", async () => {
      for (let i = 0; i < 5; i++) {
        const res = await fetch(`${base}/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": "203.0.113.50",
          },
          body: JSON.stringify({ username: "admin", password: "wrong" }),
        });
        expect(res.status).toBe(401);
      }

      const blocked = await fetch(`${base}/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "198.51.100.99",
        },
        body: JSON.stringify({ username: "admin", password: "wrong" }),
      });
      expect(blocked.status).toBe(429);
    });
  });
});
