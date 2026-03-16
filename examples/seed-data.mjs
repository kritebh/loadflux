/**
 * Usage:
 *   node examples/seed-data.mjs            # seeds into ./loadflux.db (default)
 *   node examples/seed-data.mjs path/to.db # seeds into custom path
 */

import Database from "better-sqlite3";
import { resolve } from "path";

const dbPath = resolve(process.argv[2] || "loadflux.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = OFF"); // faster bulk insert

// ── Ensure tables exist ─────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS loadflux_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  INSERT OR REPLACE INTO loadflux_settings (key, value) VALUES ('schema_version', '1');

  CREATE TABLE IF NOT EXISTS loadflux_system_metrics (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp    INTEGER NOT NULL,
    cpu_percent  REAL    NOT NULL,
    mem_total    INTEGER NOT NULL,
    mem_used     INTEGER NOT NULL,
    mem_percent  REAL    NOT NULL,
    disk_total   INTEGER,
    disk_used    INTEGER,
    disk_percent REAL,
    net_rx_bytes INTEGER NOT NULL DEFAULT 0,
    net_tx_bytes INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_system_ts ON loadflux_system_metrics(timestamp);

  CREATE TABLE IF NOT EXISTS loadflux_process_metrics (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp         INTEGER NOT NULL,
    heap_used         INTEGER NOT NULL,
    heap_total        INTEGER NOT NULL,
    external_mem      INTEGER NOT NULL,
    event_loop_avg_ms REAL    NOT NULL,
    event_loop_max_ms REAL    NOT NULL,
    gc_pause_ms       REAL    NOT NULL DEFAULT 0,
    uptime_seconds    REAL    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_process_ts ON loadflux_process_metrics(timestamp);

  CREATE TABLE IF NOT EXISTS loadflux_endpoint_metrics (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp       INTEGER NOT NULL,
    method          TEXT    NOT NULL,
    path            TEXT    NOT NULL,
    request_count   INTEGER NOT NULL DEFAULT 0,
    error_count     INTEGER NOT NULL DEFAULT 0,
    total_duration  REAL    NOT NULL DEFAULT 0,
    min_duration    REAL,
    max_duration    REAL,
    avg_duration    REAL,
    p50_duration    REAL,
    p90_duration    REAL,
    p95_duration    REAL,
    p99_duration    REAL,
    total_res_bytes INTEGER NOT NULL DEFAULT 0,
    status_2xx      INTEGER NOT NULL DEFAULT 0,
    status_3xx      INTEGER NOT NULL DEFAULT 0,
    status_4xx      INTEGER NOT NULL DEFAULT 0,
    status_5xx      INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_endpoint_ts ON loadflux_endpoint_metrics(timestamp);

  CREATE TABLE IF NOT EXISTS loadflux_error_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   INTEGER NOT NULL,
    method      TEXT    NOT NULL,
    path        TEXT    NOT NULL,
    status_code INTEGER NOT NULL,
    error_msg   TEXT,
    stack_trace TEXT,
    duration_ms REAL
  );
  CREATE INDEX IF NOT EXISTS idx_error_ts ON loadflux_error_log(timestamp);
`);

// ── Helpers ─────────────────────────────────────────────────────────────────
const rand = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max));

// Simulate a daily pattern: higher CPU/traffic during "business hours"
function dailyMultiplier(hour) {
  if (hour >= 9 && hour <= 17) return 1.0 + rand(0, 0.5); // peak
  if (hour >= 6 && hour <= 21) return 0.6 + rand(0, 0.3); // moderate
  return 0.2 + rand(0, 0.2); // night
}

// ── Config ──────────────────────────────────────────────────────────────────
const DAYS = 30;
const INTERVAL_MS = 30_000; // one data point every 30 seconds
const NOW = Date.now();
const START = NOW - DAYS * 24 * 60 * 60 * 1000;
const TOTAL_POINTS = Math.floor((NOW - START) / INTERVAL_MS);

const MEM_TOTAL = 16 * 1024 * 1024 * 1024; // 16 GB
const DISK_TOTAL = 500 * 1024 * 1024 * 1024; // 500 GB

const ENDPOINTS = [
  { method: "GET", path: "/" },
  { method: "GET", path: "/api/users" },
  { method: "GET", path: "/api/users/:id" },
  { method: "POST", path: "/api/users" },
  { method: "GET", path: "/api/slow" },
  { method: "GET", path: "/api/error" },
  { method: "GET", path: "/api/notfound" },
];

// ── Prepared statements ─────────────────────────────────────────────────────
const insertSystem = db.prepare(`
  INSERT INTO loadflux_system_metrics
    (timestamp, cpu_percent, mem_total, mem_used, mem_percent,
     disk_total, disk_used, disk_percent, net_rx_bytes, net_tx_bytes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertProcess = db.prepare(`
  INSERT INTO loadflux_process_metrics
    (timestamp, heap_used, heap_total, external_mem,
     event_loop_avg_ms, event_loop_max_ms, gc_pause_ms, uptime_seconds)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertEndpoint = db.prepare(`
  INSERT INTO loadflux_endpoint_metrics
    (timestamp, method, path, request_count, error_count,
     total_duration, min_duration, max_duration, avg_duration,
     p50_duration, p90_duration, p95_duration, p99_duration,
     total_res_bytes, status_2xx, status_3xx, status_4xx, status_5xx)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertError = db.prepare(`
  INSERT INTO loadflux_error_log
    (timestamp, method, path, status_code, error_msg, stack_trace, duration_ms)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

// ── Insert in a single transaction for speed ────────────────────────────────
console.log(
  `Seeding ${TOTAL_POINTS} data points (${DAYS} days) into ${dbPath} ...`,
);

let diskUsed = DISK_TOTAL * 0.4; // start at 40% full

const batchInsert = db.transaction(() => {
  for (let i = 0; i < TOTAL_POINTS; i++) {
    const ts = START + i * INTERVAL_MS;
    const date = new Date(ts);
    const hour = date.getHours();
    const mult = dailyMultiplier(hour);

    // ── System metrics ──────────────────────────────────────────────
    const cpuPercent = Math.min(100, rand(5, 30) * mult);
    const memUsed = MEM_TOTAL * (0.35 + rand(0, 0.25) * mult);
    const memPercent = (memUsed / MEM_TOTAL) * 100;
    // Disk slowly fills over time
    diskUsed += rand(0, 50_000);
    const diskPercent = (diskUsed / DISK_TOTAL) * 100;

    insertSystem.run(
      ts,
      cpuPercent,
      MEM_TOTAL,
      Math.floor(memUsed),
      memPercent,
      DISK_TOTAL,
      Math.floor(diskUsed),
      diskPercent,
      randInt(1000, 500_000) * mult, // net_rx
      randInt(500, 200_000) * mult, // net_tx
    );

    // ── Process metrics ─────────────────────────────────────────────
    const heapTotal = 150 * 1024 * 1024; // ~150 MB
    const heapUsed = heapTotal * (0.4 + rand(0, 0.3) * mult);
    const uptimeSeconds = (ts - START) / 1000;

    insertProcess.run(
      ts,
      Math.floor(heapUsed),
      heapTotal,
      randInt(1_000_000, 5_000_000),
      rand(0.5, 5) * mult, // event_loop_avg
      rand(2, 50) * mult, // event_loop_max
      rand(0, 3), // gc_pause
      uptimeSeconds,
    );

    // ── Endpoint metrics (one row per endpoint per interval) ────────
    for (const ep of ENDPOINTS) {
      const reqCount = Math.floor(rand(1, 20) * mult);
      if (reqCount === 0) continue;

      const isError = ep.path === "/api/error";
      const isNotFound = ep.path === "/api/notfound";
      const isSlow = ep.path === "/api/slow";

      const baseDuration = isSlow ? rand(400, 800) : rand(2, 80);
      const avgDur = baseDuration * (0.8 + rand(0, 0.4));
      const minDur = avgDur * rand(0.3, 0.7);
      const maxDur = avgDur * rand(1.5, 4);
      const p50 = avgDur * rand(0.8, 1.1);
      const p90 = avgDur * rand(1.2, 1.8);
      const p95 = avgDur * rand(1.5, 2.5);
      const p99 = avgDur * rand(2, 4);
      const totalDur = avgDur * reqCount;
      const totalResBytes = reqCount * randInt(200, 5000);

      const errorCount = isError
        ? reqCount
        : isNotFound
          ? Math.floor(reqCount * 0.8)
          : randInt(0, Math.max(1, Math.floor(reqCount * 0.05)));

      const s2xx = isError
        ? 0
        : isNotFound
          ? Math.floor(reqCount * 0.2)
          : reqCount - errorCount;
      const s4xx = isNotFound ? Math.floor(reqCount * 0.8) : 0;
      const s5xx = isError ? reqCount : errorCount;
      const s3xx = 0;

      insertEndpoint.run(
        ts,
        ep.method,
        ep.path,
        reqCount,
        errorCount,
        totalDur,
        minDur,
        maxDur,
        avgDur,
        p50,
        p90,
        p95,
        p99,
        totalResBytes,
        s2xx,
        s3xx,
        s4xx,
        s5xx,
      );

      // ── Error log entries ───────────────────────────────────────
      if (errorCount > 0 && (isError || isNotFound)) {
        insertError.run(
          ts,
          ep.method,
          ep.path,
          isError ? 500 : 404,
          isError ? "Internal Server Error" : "Not Found",
          isError
            ? "Error: Something went wrong\n    at handler (/app/routes.js:42:11)"
            : null,
          avgDur,
        );
      }
    }

    // Progress every 10%
    if (i > 0 && i % Math.floor(TOTAL_POINTS / 10) === 0) {
      const pct = Math.round((i / TOTAL_POINTS) * 100);
      process.stdout.write(`  ${pct}%...`);
    }
  }
});

batchInsert();

console.log("\nDone!");

const systemCount = db
  .prepare("SELECT COUNT(*) as c FROM loadflux_system_metrics")
  .get();
const processCount = db
  .prepare("SELECT COUNT(*) as c FROM loadflux_process_metrics")
  .get();
const endpointCount = db
  .prepare("SELECT COUNT(*) as c FROM loadflux_endpoint_metrics")
  .get();
const errorCount = db
  .prepare("SELECT COUNT(*) as c FROM loadflux_error_log")
  .get();

console.log(`\nInserted rows:`);
console.log(`  System metrics:   ${systemCount.c.toLocaleString()}`);
console.log(`  Process metrics:  ${processCount.c.toLocaleString()}`);
console.log(`  Endpoint metrics: ${endpointCount.c.toLocaleString()}`);
console.log(`  Error log:        ${errorCount.c.toLocaleString()}`);
console.log(`\nNow start the test server: node examples/test-server.mjs`);

db.close();
