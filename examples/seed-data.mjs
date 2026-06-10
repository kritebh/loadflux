/**
 * Seed synthetic metrics into a SQLite DB LoadFlux can open (same schema as migrations).
 *
 * Usage:
 *   node examples/seed-data.mjs                    # ./loadflux.db, last 30 days, hourly points
 *   node examples/seed-data.mjs ./other.db         # custom path
 *   node examples/seed-data.mjs --replace          # clear metric + error tables first
 *   node examples/seed-data.mjs --days=14          # span last N calendar days (from midnight)
 *   node examples/seed-data.mjs --interval-minutes=30   # denser points (slower / more rows)
 *
 * Default is **hourly** samples so ~30 days ≈ 720 rows/table (fast seed + fast charts).
 * Use the dashboard time picker and choose a range up to your --days window to see the full span.
 */

import Database from "better-sqlite3";
import { resolve } from "path";

function parseArgs(argv) {
  const flags = new Set();
  let days = 30;
  let intervalMinutes = 60;
  const pos = [];
  for (const a of argv) {
    if (a === "--replace" || a === "--fresh") {
      flags.add("replace");
      continue;
    }
    if (a.startsWith("--days=")) {
      const n = parseInt(a.slice("--days=".length), 10);
      if (Number.isFinite(n) && n >= 1 && n <= 365) days = n;
      continue;
    }
    if (a.startsWith("--interval-minutes=")) {
      const n = parseInt(a.slice("--interval-minutes=".length), 10);
      if (Number.isFinite(n) && n >= 1 && n <= 1440) intervalMinutes = n;
      continue;
    }
    if (!a.startsWith("--")) pos.push(a);
  }
  return {
    dbPath: resolve(pos[0] || "loadflux.db"),
    replace: flags.has("replace"),
    days,
    intervalMinutes,
  };
}

const {
  dbPath,
  replace,
  days: DAYS,
  intervalMinutes,
} = parseArgs(process.argv.slice(2));

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = OFF");

// ── Ensure tables exist (aligned with src/db/sqlite.ts migration v1) ───────
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
  CREATE INDEX IF NOT EXISTS idx_endpoint_path ON loadflux_endpoint_metrics(method, path);

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
  CREATE INDEX IF NOT EXISTS idx_error_path ON loadflux_error_log(method, path);
`);

if (replace) {
  db.exec(`
    DELETE FROM loadflux_system_metrics;
    DELETE FROM loadflux_process_metrics;
    DELETE FROM loadflux_endpoint_metrics;
    DELETE FROM loadflux_error_log;
  `);
  console.log("Cleared metric + error tables (--replace).");
}

const rand = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max));

function dailyMultiplier(hour) {
  if (hour >= 9 && hour <= 17) return 1.0 + rand(0, 0.5);
  if (hour >= 6 && hour <= 21) return 0.6 + rand(0, 0.3);
  return 0.2 + rand(0, 0.2);
}

const INTERVAL_MS = intervalMinutes * 60 * 1000;
const NOW = Date.now();

// Calendar span: from local midnight N days ago through NOW (so UI “last 30 days” includes full days)
const endAnchor = new Date(NOW);
const startAnchor = new Date(endAnchor);
startAnchor.setHours(0, 0, 0, 0);
startAnchor.setDate(startAnchor.getDate() - DAYS);
const START = startAnchor.getTime();
const END = NOW;

const timestamps = [];
for (let t = START; t <= END; t += INTERVAL_MS) {
  timestamps.push(Math.round(t));
}
const lastTs = timestamps[timestamps.length - 1];
if (lastTs !== undefined && END > lastTs && END - lastTs > INTERVAL_MS / 4) {
  timestamps.push(END);
}

const TOTAL_POINTS = timestamps.length;

const MEM_TOTAL = 16 * 1024 * 1024 * 1024;
const DISK_TOTAL = 500 * 1024 * 1024 * 1024;

const ENDPOINTS = [
  { method: "GET", path: "/" },
  { method: "GET", path: "/api/users" },
  { method: "GET", path: "/api/users/:id" },
  { method: "POST", path: "/api/users" },
  { method: "GET", path: "/api/slow" },
  { method: "GET", path: "/api/error" },
  { method: "GET", path: "/api/notfound" },
];

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

console.log(
  `Seeding ${TOTAL_POINTS} time buckets (${DAYS} calendar days, every ${intervalMinutes}m) → ${dbPath}`,
);
console.log(
  `  Range: ${new Date(START).toISOString()} … ${new Date(END).toISOString()}`,
);

let diskUsed = DISK_TOTAL * 0.4;

const batchInsert = db.transaction((tsList) => {
  let i = 0;
  for (const ts of tsList) {
    const date = new Date(ts);
    const hour = date.getHours();
    const mult = dailyMultiplier(hour);

    const cpuPercent = Math.min(100, rand(5, 30) * mult);
    const memUsed = MEM_TOTAL * (0.35 + rand(0, 0.25) * mult);
    const memPercent = (memUsed / MEM_TOTAL) * 100;
    diskUsed += rand(0, 50_000) * (INTERVAL_MS / (60 * 60 * 1000));
    const diskPercent = Math.min(100, (diskUsed / DISK_TOTAL) * 100);

    insertSystem.run(
      ts,
      cpuPercent,
      MEM_TOTAL,
      Math.floor(memUsed),
      memPercent,
      DISK_TOTAL,
      Math.floor(diskUsed),
      diskPercent,
      randInt(1000, 500_000) * mult,
      randInt(500, 200_000) * mult,
    );

    const heapTotal = 150 * 1024 * 1024;
    const heapUsed = heapTotal * (0.4 + rand(0, 0.3) * mult);
    const uptimeSeconds = (ts - START) / 1000;

    insertProcess.run(
      ts,
      Math.floor(heapUsed),
      heapTotal,
      randInt(1_000_000, 5_000_000),
      rand(0.5, 5) * mult,
      rand(2, 50) * mult,
      rand(0, 3),
      uptimeSeconds,
    );

    for (const ep of ENDPOINTS) {
      const reqCount = Math.max(
        1,
        Math.floor(rand(1, 120) * mult * (intervalMinutes / 60)),
      );

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

      if (errorCount > 0 && (isError || isNotFound)) {
        const perLog = Math.min(
          errorCount,
          isError ? randInt(1, 4) : randInt(1, 3),
        );
        for (let k = 0; k < perLog; k++) {
          insertError.run(
            ts + k,
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
    }

    i++;
    const step = Math.max(1, Math.floor(tsList.length / 10));
    if (i % step === 0) {
      process.stdout.write(`  ${Math.round((i / tsList.length) * 100)}%...`);
    }
  }
});

batchInsert(timestamps);

console.log("\nDone!");

const rangeRow = db
  .prepare(
    `SELECT MIN(timestamp) as lo, MAX(timestamp) as hi FROM loadflux_system_metrics`,
  )
  .get();
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
if (rangeRow?.lo != null) {
  console.log(`\nSystem metric time span in DB:`);
  console.log(
    `  ${new Date(rangeRow.lo).toISOString()} … ${new Date(rangeRow.hi).toISOString()}`,
  );
}
console.log(
  `\nIn the dashboard: open Time range, set From/To across this window (e.g. last ${DAYS} days) and Apply.`,
);
console.log(
  `Start test server: node examples/test-server.mjs (uses cwd ./loadflux.db unless configured)\n`,
);

db.close();
