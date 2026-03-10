import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Aggregator } from "../../src/core/aggregator.js";
import { SQLiteAdapter } from "../../src/db/sqlite.js";
import fs from "fs";
import path from "path";
import os from "os";

function tmpDbPath(): string {
  return path.join(os.tmpdir(), `loadflux-agg-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe("Aggregator", () => {
  let db: SQLiteAdapter;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = tmpDbPath();
    db = new SQLiteAdapter(dbPath);
    await db.connect();
  });

  afterEach(async () => {
    await db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { fs.unlinkSync(dbPath + suffix); } catch {}
    }
  });

  it("buffers records and flushes to DB on stop", async () => {
    const agg = new Aggregator(db, 60_000); // long window so it won't auto-flush
    agg.start();

    const now = Date.now();
    agg.record({
      method: "GET", path: "/api/test", statusCode: 200,
      durationMs: 50, responseBytes: 1024, timestamp: now,
    });
    agg.record({
      method: "GET", path: "/api/test", statusCode: 200,
      durationMs: 100, responseBytes: 2048, timestamp: now,
    });
    agg.record({
      method: "POST", path: "/api/data", statusCode: 500,
      durationMs: 200, responseBytes: 512, timestamp: now,
      errorMessage: "Server Error",
    });

    agg.stop(); // triggers final flush

    const endpoints = await db.getEndpointMetrics({ from: now - 1000, to: now + 60000 });
    expect(endpoints.length).toBe(2);

    const getTest = endpoints.find(e => e.path === "/api/test");
    expect(getTest).toBeDefined();
    expect(getTest!.request_count).toBe(2);
    expect(getTest!.status_2xx).toBe(2);
    expect(getTest!.avg_duration).toBe(75); // (50+100)/2
    expect(getTest!.min_duration).toBe(50);
    expect(getTest!.max_duration).toBe(100);

    const postData = endpoints.find(e => e.path === "/api/data");
    expect(postData).toBeDefined();
    expect(postData!.request_count).toBe(1);
    expect(postData!.error_count).toBe(1);
    expect(postData!.status_5xx).toBe(1);
  });

  it("logs errors to error_log table", async () => {
    const agg = new Aggregator(db, 60_000);
    agg.start();

    const now = Date.now();
    agg.record({
      method: "GET", path: "/fail", statusCode: 404,
      durationMs: 5, responseBytes: 100, timestamp: now,
    });
    agg.record({
      method: "POST", path: "/crash", statusCode: 500,
      durationMs: 150, responseBytes: 0, timestamp: now,
      errorMessage: "Crash", stackTrace: "at line 1",
    });

    agg.stop();

    const errors = await db.getErrorLog({ from: now - 1000, to: now + 60000 });
    expect(errors.length).toBe(2);
    expect(errors.some(e => e.status_code === 404)).toBe(true);
    expect(errors.some(e => e.status_code === 500)).toBe(true);
  });

  it("computes percentiles correctly", async () => {
    const agg = new Aggregator(db, 60_000);
    agg.start();

    const now = Date.now();
    // Insert 100 requests with durations 1..100
    for (let i = 1; i <= 100; i++) {
      agg.record({
        method: "GET", path: "/perc", statusCode: 200,
        durationMs: i, responseBytes: 100, timestamp: now,
      });
    }

    agg.stop();

    const endpoints = await db.getEndpointMetrics({ from: now - 1000, to: now + 60000 });
    expect(endpoints.length).toBe(1);

    const row = endpoints[0];
    expect(row.p50_duration).toBe(50);
    expect(row.p90_duration).toBe(90);
    expect(row.p95_duration).toBe(95);
    expect(row.p99_duration).toBe(99);
  });
});
