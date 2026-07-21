import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import { SQLiteAdapter } from "../../src/db/sqlite.js";
import { tmpDbPath, cleanupSqliteDb } from "../helpers/db.js";

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
    cleanupSqliteDb(dbPath);
  });

  it("creates database and runs migrations", async () => {
    expect(fs.existsSync(dbPath)).toBe(true);
    const version = await db.getSetting("schema_version");
    expect(version).toBe("2");
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

  it("samples system metrics for large ranges", async () => {
    const start = Date.now() - 100_000;
    for (let i = 0; i < 120; i++) {
      db.insertSystemMetrics({
        timestamp: start + i * 1000,
        cpu_percent: 10 + (i % 30),
        mem_total: 16_000_000_000,
        mem_used: 8_000_000_000 + i * 1000,
        mem_percent: 50 + (i % 10),
        disk_total: 500_000_000_000,
        disk_used: 250_000_000_000,
        disk_percent: 50,
        net_rx_bytes: i * 100,
        net_tx_bytes: i * 120,
      });
    }

    const sampled = await db.getSystemMetrics(
      { from: start, to: start + 120_000 },
      12,
    );
    expect(sampled.length).toBeLessThanOrEqual(12);
    expect(sampled.length).toBeGreaterThan(0);
    expect(sampled[0].timestamp).toBeGreaterThanOrEqual(start);
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

  it("filters paginated endpoint and error queries", async () => {
    const now = Date.now();
    db.insertEndpointMetricsBatch([
      {
        timestamp: now,
        method: "GET",
        path: "/alpha/users",
        request_count: 10,
        error_count: 0,
        total_duration: 100,
        min_duration: 1,
        max_duration: 20,
        avg_duration: 10,
        p50_duration: 9,
        p90_duration: 14,
        p95_duration: 16,
        p99_duration: 18,
        total_res_bytes: 1000,
        status_2xx: 10,
        status_3xx: 0,
        status_4xx: 0,
        status_5xx: 0,
      },
      {
        timestamp: now + 10,
        method: "POST",
        path: "/beta/users",
        request_count: 12,
        error_count: 1,
        total_duration: 200,
        min_duration: 2,
        max_duration: 30,
        avg_duration: 16,
        p50_duration: 10,
        p90_duration: 20,
        p95_duration: 25,
        p99_duration: 28,
        total_res_bytes: 2000,
        status_2xx: 11,
        status_3xx: 0,
        status_4xx: 1,
        status_5xx: 0,
      },
    ]);

    db.insertError({
      timestamp: now,
      method: "GET",
      path: "/alpha/users",
      status_code: 500,
      error_msg: "alpha exploded",
      stack_trace: null,
      duration_ms: 30,
    });
    db.insertError({
      timestamp: now + 1,
      method: "POST",
      path: "/beta/users",
      status_code: 400,
      error_msg: "beta bad request",
      stack_trace: null,
      duration_ms: 20,
    });

    const endpointPage = await db.getEndpointMetricsPaginated(
      { from: now - 1000, to: now + 2000 },
      { page: 1, limit: 50 },
      { search: "alpha" },
    );
    expect(endpointPage.data.length).toBe(1);
    expect(endpointPage.data[0].path).toContain("/alpha");

    const errorPage = await db.getErrorLogPaginated(
      { from: now - 1000, to: now + 2000 },
      { page: 1, limit: 50 },
      { search: "beta" },
    );
    expect(errorPage.data.length).toBe(1);
    expect(errorPage.data[0].path).toContain("/beta");

    const statusPage = await db.getErrorLogPaginated(
      { from: now - 1000, to: now + 2000 },
      { page: 1, limit: 50 },
      { status: "5xx" },
    );
    expect(statusPage.data.length).toBe(1);
    expect(statusPage.data[0].status_code).toBe(500);
  });

  it("treats SQL-like search input as literal text", async () => {
    const now = Date.now();
    db.insertEndpointMetricsBatch([
      {
        timestamp: now,
        method: "GET",
        path: "/api/users",
        request_count: 5,
        error_count: 0,
        total_duration: 50,
        min_duration: 5,
        max_duration: 20,
        avg_duration: 10,
        p50_duration: 9,
        p90_duration: 14,
        p95_duration: 16,
        p99_duration: 18,
        total_res_bytes: 500,
        status_2xx: 5,
        status_3xx: 0,
        status_4xx: 0,
        status_5xx: 0,
      },
      {
        timestamp: now,
        method: "GET",
        path: "/' OR 1=1 --",
        request_count: 1,
        error_count: 0,
        total_duration: 10,
        min_duration: 5,
        max_duration: 10,
        avg_duration: 10,
        p50_duration: 10,
        p90_duration: 10,
        p95_duration: 10,
        p99_duration: 10,
        total_res_bytes: 100,
        status_2xx: 1,
        status_3xx: 0,
        status_4xx: 0,
        status_5xx: 0,
      },
    ]);

    const page = await db.getEndpointMetricsPaginated(
      { from: now - 1000, to: now + 2000 },
      { page: 1, limit: 50 },
      { search: "' OR 1=1 --" },
    );
    expect(page.data.length).toBe(1);
    expect(page.data[0].path).toBe("/' OR 1=1 --");
  });

  it("does not treat LIKE wildcards in search as pattern matchers", async () => {
    const now = Date.now();
    db.insertEndpointMetricsBatch([
      {
        timestamp: now,
        method: "GET",
        path: "/api/users",
        request_count: 5,
        error_count: 0,
        total_duration: 50,
        min_duration: 5,
        max_duration: 20,
        avg_duration: 10,
        p50_duration: 9,
        p90_duration: 14,
        p95_duration: 16,
        p99_duration: 18,
        total_res_bytes: 500,
        status_2xx: 5,
        status_3xx: 0,
        status_4xx: 0,
        status_5xx: 0,
      },
      {
        timestamp: now,
        method: "GET",
        path: "/sale/100%off",
        request_count: 2,
        error_count: 0,
        total_duration: 20,
        min_duration: 5,
        max_duration: 15,
        avg_duration: 10,
        p50_duration: 10,
        p90_duration: 12,
        p95_duration: 14,
        p99_duration: 15,
        total_res_bytes: 200,
        status_2xx: 2,
        status_3xx: 0,
        status_4xx: 0,
        status_5xx: 0,
      },
    ]);

    const page = await db.getEndpointMetricsPaginated(
      { from: now - 1000, to: now + 2000 },
      { page: 1, limit: 50 },
      { search: "%" },
    );
    expect(page.data.length).toBe(1);
    expect(page.data[0].path).toBe("/sale/100%off");
  });

  it("returns distinct error status codes in range", async () => {
    const now = Date.now();
    db.insertError({
      timestamp: now,
      method: "GET",
      path: "/a",
      status_code: 404,
      error_msg: "nf",
      stack_trace: null,
      duration_ms: 10,
    });
    db.insertError({
      timestamp: now + 1,
      method: "GET",
      path: "/b",
      status_code: 500,
      error_msg: "err",
      stack_trace: null,
      duration_ms: 20,
    });
    db.insertError({
      timestamp: now + 2,
      method: "GET",
      path: "/c",
      status_code: 500,
      error_msg: "err2",
      stack_trace: null,
      duration_ms: 30,
    });

    const codes = await db.getErrorStatusCodes({ from: now - 1000, to: now + 5000 });
    expect(codes).toEqual([404, 500]);
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

  it("hasAnyUser reflects whether any auth row exists", async () => {
    expect(await db.hasAnyUser()).toBe(false);
    db.createUser("first", "hash");
    expect(await db.hasAnyUser()).toBe(true);
  });
});
