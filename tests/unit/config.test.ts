import { describe, it, expect } from "vitest";
import { resolveConfig } from "../../src/config.js";

describe("resolveConfig", () => {
  it("returns defaults when no config provided", () => {
    const prevHost = process.env.HOST;
    const prevLf = process.env.LOADFLUX_LISTEN_HOST;
    const prevTp = process.env.LOADFLUX_TRUST_PROXY;
    delete process.env.HOST;
    delete process.env.LOADFLUX_LISTEN_HOST;
    delete process.env.LOADFLUX_TRUST_PROXY;
    try {
      const config = resolveConfig();
      expect(config.path).toBe("/loadflux");
      expect(config.framework).toBe("express");
      expect(config.database.adapter).toBe("sqlite");
      expect(config.auth).toBeNull();
      expect(config.collection.systemInterval).toBe(5000);
      expect(config.collection.aggregationWindow).toBe(5000);
      expect(config.retention.days).toBe(90);
      expect(config.slowRequestThreshold).toBe(500);
      expect(config.excludeRoutes).toEqual([]);
      expect(config.disableOnLocalhost).toBe(false);
      expect(config.listenHost).toBeNull();
      expect(config.trustProxy).toBe(false);
    } finally {
      if (prevHost !== undefined) process.env.HOST = prevHost;
      if (prevLf !== undefined) process.env.LOADFLUX_LISTEN_HOST = prevLf;
      if (prevTp !== undefined) process.env.LOADFLUX_TRUST_PROXY = prevTp;
    }
  });

  it("merges user config with defaults", () => {
    const config = resolveConfig({
      path: "/monitor",
      auth: { username: "admin", password: "secret" },
      retention: { days: 30 },
    });
    expect(config.path).toBe("/monitor");
    expect(config.auth).toEqual({ username: "admin", password: "secret" });
    expect(config.retention.days).toBe(30);
    // defaults still applied
    expect(config.collection.systemInterval).toBe(5000);
  });

  it("normalizes path with leading slash", () => {
    const config = resolveConfig({ path: "monitor" });
    expect(config.path).toBe("/monitor");
  });

  it("strips trailing slash from path", () => {
    const config = resolveConfig({ path: "/monitor/" });
    expect(config.path).toBe("/monitor");
  });

  it("throws for systemInterval < 1000", () => {
    expect(() =>
      resolveConfig({ collection: { systemInterval: 500 } })
    ).toThrow("systemInterval must be >= 1000ms");
  });

  it("throws for aggregationWindow < 1000", () => {
    expect(() =>
      resolveConfig({ collection: { aggregationWindow: 100 } })
    ).toThrow("aggregationWindow must be >= 1000ms");
  });

  it("throws for retention days < 1", () => {
    expect(() => resolveConfig({ retention: { days: 0 } })).toThrow(
      "retention days must be >= 1"
    );
  });

  it("throws for negative slowRequestThreshold", () => {
    expect(() => resolveConfig({ slowRequestThreshold: -1 })).toThrow(
      "slowRequestThreshold must be >= 0"
    );
  });

  it("throws for unsupported database adapter", () => {
    expect(() =>
      resolveConfig({ database: { adapter: "mysql" as any } })
    ).toThrow('unsupported database adapter "mysql"');
  });

  it("uses mongodb default connection string when adapter is mongodb", () => {
    const config = resolveConfig({ database: { adapter: "mongodb" } });
    expect(config.database.connectionString).toBe(
      "mongodb://localhost:27017/loadflux"
    );
  });

  it("merges disableOnLocalhost and listenHost", () => {
    const config = resolveConfig({
      disableOnLocalhost: true,
      listenHost: "127.0.0.1",
    });
    expect(config.disableOnLocalhost).toBe(true);
    expect(config.listenHost).toBe("127.0.0.1");
  });

  it("treats 0.0.0.0 as non-loopback listenHost", () => {
    const config = resolveConfig({
      disableOnLocalhost: true,
      listenHost: "0.0.0.0",
    });
    expect(config.listenHost).toBe("0.0.0.0");
  });

  it("resolves listenHost from LOADFLUX_LISTEN_HOST or HOST env", () => {
    const prevLf = process.env.LOADFLUX_LISTEN_HOST;
    const prevHost = process.env.HOST;
    delete process.env.LOADFLUX_LISTEN_HOST;
    delete process.env.HOST;
    try {
      process.env.LOADFLUX_LISTEN_HOST = "192.168.0.5";
      expect(resolveConfig().listenHost).toBe("192.168.0.5");

      delete process.env.LOADFLUX_LISTEN_HOST;
      process.env.HOST = "10.0.0.1";
      expect(resolveConfig().listenHost).toBe("10.0.0.1");
    } finally {
      if (prevLf !== undefined) process.env.LOADFLUX_LISTEN_HOST = prevLf;
      else delete process.env.LOADFLUX_LISTEN_HOST;
      if (prevHost !== undefined) process.env.HOST = prevHost;
      else delete process.env.HOST;
    }
  });

  it("enables trustProxy from config or LOADFLUX_TRUST_PROXY", () => {
    expect(resolveConfig({ trustProxy: true }).trustProxy).toBe(true);
    expect(resolveConfig({ trustProxy: false }).trustProxy).toBe(false);
    const prev = process.env.LOADFLUX_TRUST_PROXY;
    process.env.LOADFLUX_TRUST_PROXY = "1";
    try {
      expect(resolveConfig().trustProxy).toBe(true);
    } finally {
      if (prev !== undefined) process.env.LOADFLUX_TRUST_PROXY = prev;
      else delete process.env.LOADFLUX_TRUST_PROXY;
    }
  });
});
