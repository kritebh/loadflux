import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MetricsStore } from "../../src/core/metrics-store.js";
import { resolveConfig } from "../../src/config.js";
import { SQLiteAdapter } from "../../src/db/sqlite.js";
import { tmpDbPath, cleanupSqliteDb } from "../helpers/db.js";

describe("MetricsStore", () => {
  let db: SQLiteAdapter;
  let dbPath: string;
  let store: MetricsStore;

  beforeEach(async () => {
    dbPath = tmpDbPath("loadflux-metrics-store-test");
    db = new SQLiteAdapter(dbPath);
    await db.connect();
    store = new MetricsStore(
      db,
      resolveConfig({
        database: { connectionString: dbPath },
        collection: { systemInterval: 60_000, aggregationWindow: 60_000 },
      }),
    );
  });

  afterEach(async () => {
    store.stop();
    await db.close();
    cleanupSqliteDb(dbPath);
  });

  it("tracks RPS and RPM with second buckets", async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      store.recordRequest({
        method: "GET",
        path: "/api/test",
        statusCode: 200,
        durationMs: 10,
        responseBytes: 100,
        timestamp: now + i,
      });
    }

    const snapshot = await store.getCurrentSnapshot();
    expect(snapshot.overview.rps).toBe(5);
    expect(snapshot.overview.rpm).toBe(5);
    expect(snapshot.overview.total_requests).toBe(5);
  });

  it("expires buckets older than 60 seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

    store.recordRequest({
      method: "GET",
      path: "/old",
      statusCode: 200,
      durationMs: 10,
      responseBytes: 100,
      timestamp: Date.now(),
    });

    vi.advanceTimersByTime(65_000);

    store.recordRequest({
      method: "GET",
      path: "/new",
      statusCode: 200,
      durationMs: 10,
      responseBytes: 100,
      timestamp: Date.now(),
    });
    store.recordRequest({
      method: "GET",
      path: "/new",
      statusCode: 200,
      durationMs: 10,
      responseBytes: 100,
      timestamp: Date.now(),
    });

    const snapshot = await store.getCurrentSnapshot();
    expect(snapshot.overview.rpm).toBe(2);
    expect(snapshot.overview.total_requests).toBe(3);

    vi.useRealTimers();
  });
});
