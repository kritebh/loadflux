import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SQLiteAdapter } from "../../src/db/sqlite.js";
import fs from "fs";
import path from "path";
import os from "os";

function tmpDbPath(): string {
  return path.join(os.tmpdir(), `loadflux-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe("SQLiteAdapter", () => {
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

  it("creates database and runs migrations", async () => {
    expect(fs.existsSync(dbPath)).toBe(true);
    const version = await db.getSetting("schema_version");
    expect(version).toBe("1");
  });

  it("inserts and queries system metrics", async () => {
    const now = Date.now();
    db.insertSystemMetrics({
      timestamp: now,
      cpu_percent: 25.5,
      mem_total: 16_000_000_000,
      mem_used: 8_000_000_000,
      mem_percent: 50.0,
      disk_total: 500_000_000_000,
      disk_used: 250_000_000_000,
      disk_percent: 50.0,
      net_rx_bytes: 1024,
      net_tx_bytes: 2048,
    });

    const rows = await db.getSystemMetrics({ from: now - 1000, to: now + 1000 });
    expect(rows.length).toBe(1);
    expect(rows[0].cpu_percent).toBe(25.5);
    expect(rows[0].mem_percent).toBe(50.0);
  });

  it("inserts and queries process metrics", async () => {
    const now = Date.now();
    db.insertProcessMetrics({
      timestamp: now,
      heap_used: 50_000_000,
      heap_total: 100_000_000,
      external_mem: 5_000_000,
      event_loop_avg_ms: 1.5,
      event_loop_max_ms: 10.2,
      gc_pause_ms: 0.5,
      uptime_seconds: 3600,
    });

    const rows = await db.getProcessMetrics({ from: now - 1000, to: now + 1000 });
    expect(rows.length).toBe(1);
    expect(rows[0].heap_used).toBe(50_000_000);
    expect(rows[0].uptime_seconds).toBe(3600);
  });

  it("inserts and queries endpoint metrics batch", async () => {
    const now = Date.now();
    db.insertEndpointMetricsBatch([
      {
        timestamp: now,
        method: "GET",
        path: "/api/users",
        request_count: 100,
        error_count: 5,
        total_duration: 5000,
        min_duration: 10,
        max_duration: 200,
        avg_duration: 50,
        p50_duration: 45,
        p90_duration: 150,
        p95_duration: 180,
        p99_duration: 195,
        total_res_bytes: 50000,
        status_2xx: 95,
        status_3xx: 0,
        status_4xx: 3,
        status_5xx: 2,
      },
    ]);

    const rows = await db.getEndpointMetrics({ from: now - 1000, to: now + 1000 });
    expect(rows.length).toBe(1);
    expect(rows[0].method).toBe("GET");
    expect(rows[0].request_count).toBe(100);
    expect(rows[0].p95_duration).toBe(180);
  });

  it("inserts and queries errors", async () => {
    const now = Date.now();
    db.insertError({
      timestamp: now,
      method: "POST",
      path: "/api/data",
      status_code: 500,
      error_msg: "Internal Server Error",
      stack_trace: null,
      duration_ms: 150,
    });

    const rows = await db.getErrorLog({ from: now - 1000, to: now + 1000 });
    expect(rows.length).toBe(1);
    expect(rows[0].status_code).toBe(500);
    expect(rows[0].error_msg).toBe("Internal Server Error");
  });

  it("returns top endpoints by request count", async () => {
    const now = Date.now();
    db.insertEndpointMetricsBatch([
      {
        timestamp: now, method: "GET", path: "/a",
        request_count: 100, error_count: 0,
        total_duration: 1000, min_duration: 5, max_duration: 50, avg_duration: 10,
        p50_duration: 9, p90_duration: 40, p95_duration: 45, p99_duration: 48,
        total_res_bytes: 10000, status_2xx: 100, status_3xx: 0, status_4xx: 0, status_5xx: 0,
      },
      {
        timestamp: now, method: "GET", path: "/b",
        request_count: 50, error_count: 0,
        total_duration: 500, min_duration: 5, max_duration: 50, avg_duration: 10,
        p50_duration: 9, p90_duration: 40, p95_duration: 45, p99_duration: 48,
        total_res_bytes: 5000, status_2xx: 50, status_3xx: 0, status_4xx: 0, status_5xx: 0,
      },
    ]);

    const top = await db.getTopEndpoints("request_count", 5, { from: now - 1000, to: now + 1000 });
    expect(top.length).toBe(2);
    expect(top[0].path).toBe("/a");
    expect(top[0].value).toBe(100);
  });

  it("returns status distribution", async () => {
    const now = Date.now();
    db.insertEndpointMetricsBatch([
      {
        timestamp: now, method: "GET", path: "/a",
        request_count: 10, error_count: 3,
        total_duration: 100, min_duration: 5, max_duration: 50, avg_duration: 10,
        p50_duration: 9, p90_duration: 40, p95_duration: 45, p99_duration: 48,
        total_res_bytes: 1000, status_2xx: 7, status_3xx: 0, status_4xx: 2, status_5xx: 1,
      },
    ]);

    const dist = await db.getStatusDistribution({ from: now - 1000, to: now + 1000 });
    expect(dist.status_2xx).toBe(7);
    expect(dist.status_4xx).toBe(2);
    expect(dist.status_5xx).toBe(1);
  });

  it("returns overview with p95 and p99", async () => {
    const now = Date.now();
    db.insertEndpointMetricsBatch([
      {
        timestamp: now, method: "GET", path: "/a",
        request_count: 10, error_count: 1,
        total_duration: 500, min_duration: 10, max_duration: 100, avg_duration: 50,
        p50_duration: 45, p90_duration: 80, p95_duration: 90, p99_duration: 98,
        total_res_bytes: 5000, status_2xx: 9, status_3xx: 0, status_4xx: 1, status_5xx: 0,
      },
    ]);

    const overview = await db.getOverview({ from: now - 1000, to: now + 1000 });
    expect(overview.total_requests).toBe(10);
    expect(overview.total_errors).toBe(1);
    expect(overview.error_rate).toBe(10);
    expect(overview.p95_duration).toBe(90);
    expect(overview.p99_duration).toBe(98);
  });

  it("deletes data older than cutoff", async () => {
    const old = Date.now() - 100_000;
    const recent = Date.now();

    db.insertSystemMetrics({
      timestamp: old, cpu_percent: 10, mem_total: 1, mem_used: 1, mem_percent: 100,
      disk_total: null, disk_used: null, disk_percent: null, net_rx_bytes: 0, net_tx_bytes: 0,
    });
    db.insertSystemMetrics({
      timestamp: recent, cpu_percent: 20, mem_total: 1, mem_used: 1, mem_percent: 100,
      disk_total: null, disk_used: null, disk_percent: null, net_rx_bytes: 0, net_tx_bytes: 0,
    });

    db.deleteOlderThan(recent - 1000);

    const rows = await db.getSystemMetrics({ from: 0, to: Date.now() + 1000 });
    expect(rows.length).toBe(1);
    expect(rows[0].cpu_percent).toBe(20);
  });

  it("manages settings", async () => {
    db.setSetting("test_key", "test_value");
    const value = await db.getSetting("test_key");
    expect(value).toBe("test_value");

    db.setSetting("test_key", "updated");
    const updated = await db.getSetting("test_key");
    expect(updated).toBe("updated");

    const missing = await db.getSetting("nonexistent");
    expect(missing).toBeNull();
  });

  it("manages auth users", async () => {
    db.createUser("admin", "hashed_password");
    const user = await db.getUser("admin");
    expect(user).not.toBeNull();
    expect(user!.username).toBe("admin");
    expect(user!.password_hash).toBe("hashed_password");

    const noUser = await db.getUser("nonexistent");
    expect(noUser).toBeNull();
  });
});
