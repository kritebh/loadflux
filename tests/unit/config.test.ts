import { describe, it, expect } from "vitest";
import { resolveConfig } from "../../src/config.js";

describe("resolveConfig", () => {
  it("returns defaults when no config provided", () => {
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
});
