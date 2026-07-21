import Database from "better-sqlite3";
import type {
  DatabaseAdapter,
  SystemMetricRow,
  ProcessMetricRow,
  EndpointMetricRow,
  ErrorLogRow,
  TimeRange,
  TopEndpointMetric,
  TopEndpointRow,
  StatusDistribution,
  OverviewMetrics,
  PaginationParams,
  PaginatedResult,
  QueryFilter,
  MetricsQueryOptions,
  LiveOverviewMetrics,
  LifetimeTotals,
} from "../types.js";
import {
  TABLE_SYSTEM_METRICS,
  TABLE_PROCESS_METRICS,
  TABLE_ENDPOINT_METRICS,
  TABLE_ERROR_LOG,
  TABLE_SETTINGS,
  TABLE_AUTH,
  SCHEMA_VERSION_KEY,
  LEGACY_INSTANCE_ID,
  LIFETIME_TOTAL_REQUESTS_KEY,
  LIFETIME_TOTAL_ERRORS_KEY,
  LIFETIME_TOTALS_SEEDED_KEY,
  INSTANCE_BACKFILL_DONE_KEY,
  MAX_INSTANCES_LIST,
  withRpsRpm,
  buildPaginatedResult,
} from "./constants.js";
import { aggregateProcessRows, aggregateSystemRows } from "./cluster-helpers.js";
import { logDbError } from "./utils.js";
import {
  ensureSampleSize,
  escapeLike,
  normalizeSearchTerm,
  parseStatusFilter as parseStatusFilterBase,
} from "./query-helpers.js";

type Migration = {
  version: number;
  /** Raw SQL (run via exec), or a function for idempotent / multi-step migrations. */
  run: string | ((db: Database.Database) => void);
};

function tableHasColumn(
  db: Database.Database,
  table: string,
  column: string,
): boolean {
  const cols = db.pragma(`table_info(${table})`) as { name: string }[];
  return cols.some((c) => c.name === column);
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  columnDef: string,
): void {
  const column = columnDef.trim().split(/\s+/)[0];
  if (tableHasColumn(db, table, column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
}

// Migrations embedded as code (tsup bundles everything — no filesystem reads)
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    run: `
CREATE TABLE IF NOT EXISTS ${TABLE_SYSTEM_METRICS} (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   INTEGER NOT NULL,
    cpu_percent REAL    NOT NULL,
    mem_total   INTEGER NOT NULL,
    mem_used    INTEGER NOT NULL,
    mem_percent REAL    NOT NULL,
    disk_total  INTEGER,
    disk_used   INTEGER,
    disk_percent REAL,
    net_rx_bytes INTEGER NOT NULL DEFAULT 0,
    net_tx_bytes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_system_ts ON ${TABLE_SYSTEM_METRICS}(timestamp);

CREATE TABLE IF NOT EXISTS ${TABLE_PROCESS_METRICS} (
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
CREATE INDEX IF NOT EXISTS idx_process_ts ON ${TABLE_PROCESS_METRICS}(timestamp);

CREATE TABLE IF NOT EXISTS ${TABLE_ENDPOINT_METRICS} (
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
CREATE INDEX IF NOT EXISTS idx_endpoint_ts ON ${TABLE_ENDPOINT_METRICS}(timestamp);
CREATE INDEX IF NOT EXISTS idx_endpoint_path ON ${TABLE_ENDPOINT_METRICS}(method, path);

CREATE TABLE IF NOT EXISTS ${TABLE_ERROR_LOG} (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   INTEGER NOT NULL,
    method      TEXT    NOT NULL,
    path        TEXT    NOT NULL,
    status_code INTEGER NOT NULL,
    error_msg   TEXT,
    stack_trace TEXT,
    duration_ms REAL
);
CREATE INDEX IF NOT EXISTS idx_error_ts ON ${TABLE_ERROR_LOG}(timestamp);
CREATE INDEX IF NOT EXISTS idx_error_path ON ${TABLE_ERROR_LOG}(method, path);

CREATE TABLE IF NOT EXISTS ${TABLE_AUTH} (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    created_at    INTEGER NOT NULL
);
`,
  },
  {
    version: 2,
    // Idempotent: concurrent processes can race on the same SQLite file.
    run: (db) => {
      addColumnIfMissing(db, TABLE_SYSTEM_METRICS, "instance_id TEXT");
      addColumnIfMissing(db, TABLE_PROCESS_METRICS, "instance_id TEXT");
      addColumnIfMissing(db, TABLE_ENDPOINT_METRICS, "instance_id TEXT");
      addColumnIfMissing(db, TABLE_ERROR_LOG, "instance_id TEXT");
      db.exec(`
CREATE INDEX IF NOT EXISTS idx_system_instance_ts ON ${TABLE_SYSTEM_METRICS}(instance_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_process_instance_ts ON ${TABLE_PROCESS_METRICS}(instance_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_endpoint_instance_ts ON ${TABLE_ENDPOINT_METRICS}(instance_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_error_instance_ts ON ${TABLE_ERROR_LOG}(instance_id, timestamp);
`);
      // Backfill so equality filters can use the instance_id index
      db.prepare(
        `UPDATE ${TABLE_SYSTEM_METRICS} SET instance_id = ? WHERE instance_id IS NULL`,
      ).run(LEGACY_INSTANCE_ID);
      db.prepare(
        `UPDATE ${TABLE_PROCESS_METRICS} SET instance_id = ? WHERE instance_id IS NULL`,
      ).run(LEGACY_INSTANCE_ID);
      db.prepare(
        `UPDATE ${TABLE_ENDPOINT_METRICS} SET instance_id = ? WHERE instance_id IS NULL`,
      ).run(LEGACY_INSTANCE_ID);
      db.prepare(
        `UPDATE ${TABLE_ERROR_LOG} SET instance_id = ? WHERE instance_id IS NULL`,
      ).run(LEGACY_INSTANCE_ID);
    },
  },
];

const LIKE_ESCAPE = " ESCAPE '\\'";

function normalizedSearch(search?: string): string | null {
  const term = normalizeSearchTerm(search);
  if (!term) return null;
  return `%${escapeLike(term.toLowerCase())}%`;
}

function numberOrNull(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}

function parseStatusFilter(status?: string): { clause: string; params: number[] } {
  const filter = parseStatusFilterBase(status);
  if (filter.kind === "all") return { clause: "", params: [] };
  if (filter.kind === "range") {
    return { clause: "AND status_code BETWEEN ? AND ?", params: [filter.min, filter.max] };
  }
  return { clause: "AND status_code = ?", params: [filter.code] };
}

function instanceFilterSql(
  options?: MetricsQueryOptions,
  tableAlias = "",
): { clause: string; params: string[] } {
  const prefix = tableAlias ? `${tableAlias}.` : "";
  if (!options?.instanceId) {
    return { clause: "", params: [] };
  }
  if (options.instanceId === LEGACY_INSTANCE_ID) {
    return {
      clause: `AND (${prefix}instance_id = ? OR ${prefix}instance_id IS NULL)`,
      params: [LEGACY_INSTANCE_ID],
    };
  }
  return {
    clause: `AND ${prefix}instance_id = ?`,
    params: [options.instanceId],
  };
}

export class SQLiteAdapter implements DatabaseAdapter {
  private db!: Database.Database;
  private stmts!: ReturnType<typeof this.prepareStatements>;

  constructor(private dbPath: string) {}

  async connect(): Promise<void> {
    try {
      this.db = new Database(this.dbPath);
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("synchronous = NORMAL");
    } catch (err: any) {
      // Corrupted DB file — delete and recreate
      if (
        err?.code?.startsWith("SQLITE_IOERR") ||
        err?.code === "SQLITE_CORRUPT"
      ) {
        const fs = await import("fs");
        for (const suffix of ["", "-wal", "-shm"]) {
          try {
            fs.unlinkSync(this.dbPath + suffix);
          } catch {}
        }
        console.warn(
          `LoadFlux: Corrupted database removed, creating fresh: ${this.dbPath}`,
        );
        this.db = new Database(this.dbPath);
        this.db.pragma("journal_mode = WAL");
        this.db.pragma("synchronous = NORMAL");
      } else {
        throw err;
      }
    }
    this.runMigrations();
    this.stmts = this.prepareStatements();
    this.backfillLegacyInstanceIds();
    this.seedLifetimeTotalsIfNeeded();
  }

  async close(): Promise<void> {
    // Checkpoint WAL and switch back to delete journal mode so any
    // SQLite GUI tool can open the file after shutdown
    try {
      this.db.pragma("wal_checkpoint(TRUNCATE)");
      this.db.pragma("journal_mode = DELETE");
    } catch {}
    this.db.close();
  }

  // ─── Migrations ─────────────────────────────────────────────────────────

  private runMigrations(): void {
    // Bootstrap settings table for version tracking
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE_SETTINGS} (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    const currentVersion = this.getSchemaVersion();

    for (const migration of MIGRATIONS) {
      if (migration.version <= currentVersion) continue;

      const migrate = this.db.transaction(() => {
        if (typeof migration.run === "string") {
          this.db.exec(migration.run);
        } else {
          migration.run(this.db);
        }
        this.db
          .prepare(
            `INSERT OR REPLACE INTO ${TABLE_SETTINGS} (key, value) VALUES (?, ?)`,
          )
          .run(SCHEMA_VERSION_KEY, String(migration.version));
      });
      migrate();
    }
  }

  private getSchemaVersion(): number {
    const row = this.db
      .prepare(
        `SELECT value FROM ${TABLE_SETTINGS} WHERE key = ?`,
      )
      .get(SCHEMA_VERSION_KEY) as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : 0;
  }

  private backfillLegacyInstanceIds(): void {
    try {
      // Migration v2 already backfills; this guard stops us from re-scanning all
      // four tables on every boot (the WHERE matches zero rows once done).
      const done = this.stmts.getSetting.get(INSTANCE_BACKFILL_DONE_KEY) as
        | { value: string }
        | undefined;
      if (done) return;

      for (const table of [
        TABLE_SYSTEM_METRICS,
        TABLE_PROCESS_METRICS,
        TABLE_ENDPOINT_METRICS,
        TABLE_ERROR_LOG,
      ]) {
        this.db
          .prepare(
            `UPDATE ${table} SET instance_id = ? WHERE instance_id IS NULL`,
          )
          .run(LEGACY_INSTANCE_ID);
      }
      this.stmts.setSetting.run(INSTANCE_BACKFILL_DONE_KEY, "1");
    } catch (err) {
      logDbError("SQLite backfillLegacyInstanceIds", err);
    }
  }

  private seedLifetimeTotalsIfNeeded(): void {
    try {
      const seeded = this.stmts.getSetting.get(LIFETIME_TOTALS_SEEDED_KEY) as
        | { value: string }
        | undefined;
      if (seeded) return;

      const row = this.db
        .prepare(
          `
        SELECT
          COALESCE(SUM(request_count), 0) as total_requests,
          COALESCE(SUM(error_count), 0) as total_errors
        FROM ${TABLE_ENDPOINT_METRICS}
      `,
        )
        .get() as { total_requests: number; total_errors: number };

      const seed = this.db.transaction(() => {
        this.stmts.setSetting.run(LIFETIME_TOTALS_SEEDED_KEY, "1");
        // Only insert if another writer did not already create the keys
        this.db
          .prepare(
            `INSERT OR IGNORE INTO ${TABLE_SETTINGS} (key, value) VALUES (?, ?)`,
          )
          .run(LIFETIME_TOTAL_REQUESTS_KEY, String(row.total_requests));
        this.db
          .prepare(
            `INSERT OR IGNORE INTO ${TABLE_SETTINGS} (key, value) VALUES (?, ?)`,
          )
          .run(LIFETIME_TOTAL_ERRORS_KEY, String(row.total_errors));
      });
      seed();
    } catch (err) {
      logDbError("SQLite seedLifetimeTotalsIfNeeded", err);
    }
  }

  // ─── Prepared Statements ────────────────────────────────────────────────

  private prepareStatements() {
    return {
      insertSystem: this.db.prepare(`
        INSERT INTO ${TABLE_SYSTEM_METRICS}
          (timestamp, instance_id, cpu_percent, mem_total, mem_used, mem_percent, disk_total, disk_used, disk_percent, net_rx_bytes, net_tx_bytes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      insertProcess: this.db.prepare(`
        INSERT INTO ${TABLE_PROCESS_METRICS}
          (timestamp, instance_id, heap_used, heap_total, external_mem, event_loop_avg_ms, event_loop_max_ms, gc_pause_ms, uptime_seconds)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      insertEndpoint: this.db.prepare(`
        INSERT INTO ${TABLE_ENDPOINT_METRICS}
          (timestamp, instance_id, method, path, request_count, error_count, total_duration, min_duration, max_duration, avg_duration, p50_duration, p90_duration, p95_duration, p99_duration, total_res_bytes, status_2xx, status_3xx, status_4xx, status_5xx)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      insertError: this.db.prepare(`
        INSERT INTO ${TABLE_ERROR_LOG}
          (timestamp, instance_id, method, path, status_code, error_msg, stack_trace, duration_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      getSystem: this.db.prepare(
        `SELECT * FROM ${TABLE_SYSTEM_METRICS} WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp ASC`,
      ),
      getProcess: this.db.prepare(
        `SELECT * FROM ${TABLE_PROCESS_METRICS} WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp ASC`,
      ),
      getEndpoints: this.db.prepare(
        `SELECT * FROM ${TABLE_ENDPOINT_METRICS} WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp ASC`,
      ),
      getErrors: this.db.prepare(
        `SELECT * FROM ${TABLE_ERROR_LOG} WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp DESC`,
      ),
      getSetting: this.db.prepare(
        `SELECT value FROM ${TABLE_SETTINGS} WHERE key = ?`,
      ),
      setSetting: this.db.prepare(
        `INSERT OR REPLACE INTO ${TABLE_SETTINGS} (key, value) VALUES (?, ?)`,
      ),
      incrementSetting: this.db.prepare(`
        INSERT INTO ${TABLE_SETTINGS} (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = CAST(CAST(value AS INTEGER) + CAST(excluded.value AS INTEGER) AS TEXT)
      `),
      getUser: this.db.prepare(
        `SELECT * FROM ${TABLE_AUTH} WHERE username = ?`,
      ),
      createUser: this.db.prepare(
        `INSERT INTO ${TABLE_AUTH} (username, password_hash, created_at) VALUES (?, ?, ?)`,
      ),
      updateUserPassword: this.db.prepare(
        `UPDATE ${TABLE_AUTH} SET password_hash = ? WHERE username = ?`,
      ),
      deleteSystemOlder: this.db.prepare(
        `DELETE FROM ${TABLE_SYSTEM_METRICS} WHERE timestamp < ?`,
      ),
      deleteProcessOlder: this.db.prepare(
        `DELETE FROM ${TABLE_PROCESS_METRICS} WHERE timestamp < ?`,
      ),
      deleteEndpointOlder: this.db.prepare(
        `DELETE FROM ${TABLE_ENDPOINT_METRICS} WHERE timestamp < ?`,
      ),
      deleteErrorOlder: this.db.prepare(
        `DELETE FROM ${TABLE_ERROR_LOG} WHERE timestamp < ?`,
      ),

      // Count statements for pagination
      countSystem: this.db.prepare(
        `SELECT COUNT(*) as count FROM ${TABLE_SYSTEM_METRICS} WHERE timestamp BETWEEN ? AND ?`,
      ),
      countProcess: this.db.prepare(
        `SELECT COUNT(*) as count FROM ${TABLE_PROCESS_METRICS} WHERE timestamp BETWEEN ? AND ?`,
      ),
      countEndpoints: this.db.prepare(
        `SELECT COUNT(*) as count FROM ${TABLE_ENDPOINT_METRICS} WHERE timestamp BETWEEN ? AND ?`,
      ),
      countErrors: this.db.prepare(
        `SELECT COUNT(*) as count FROM ${TABLE_ERROR_LOG} WHERE timestamp BETWEEN ? AND ?`,
      ),

      // Paginated data statements
      getSystemPaginated: this.db.prepare(
        `SELECT * FROM ${TABLE_SYSTEM_METRICS} WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp ASC LIMIT ? OFFSET ?`,
      ),
      getProcessPaginated: this.db.prepare(
        `SELECT * FROM ${TABLE_PROCESS_METRICS} WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp ASC LIMIT ? OFFSET ?`,
      ),
      getEndpointsPaginated: this.db.prepare(
        `SELECT * FROM ${TABLE_ENDPOINT_METRICS} WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp ASC LIMIT ? OFFSET ?`,
      ),
      getErrorsPaginated: this.db.prepare(
        `SELECT * FROM ${TABLE_ERROR_LOG} WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      ),
    };
  }

  // ─── Inserts ────────────────────────────────────────────────────────────

  insertSystemMetrics(m: SystemMetricRow): void {
    try {
      this.stmts.insertSystem.run(
        m.timestamp,
        m.instance_id ?? null,
        m.cpu_percent,
        m.mem_total,
        m.mem_used,
        m.mem_percent,
        m.disk_total,
        m.disk_used,
        m.disk_percent,
        m.net_rx_bytes,
        m.net_tx_bytes,
      );
    } catch (err) {
      logDbError("SQLite insertSystemMetrics", err);
    }
  }

  insertProcessMetrics(m: ProcessMetricRow): void {
    try {
      this.stmts.insertProcess.run(
        m.timestamp,
        m.instance_id ?? null,
        m.heap_used,
        m.heap_total,
        m.external_mem,
        m.event_loop_avg_ms,
        m.event_loop_max_ms,
        m.gc_pause_ms,
        m.uptime_seconds,
      );
    } catch (err) {
      logDbError("SQLite insertProcessMetrics", err);
    }
  }

  insertEndpointMetricsBatch(rows: EndpointMetricRow[]): void {
    if (rows.length === 0) return;
    try {
      let totalRequests = 0;
      let totalErrors = 0;
      const batchInsert = this.db.transaction((rows: EndpointMetricRow[]) => {
        for (const r of rows) {
          this.stmts.insertEndpoint.run(
            r.timestamp,
            r.instance_id ?? null,
            r.method,
            r.path,
            r.request_count,
            r.error_count,
            r.total_duration,
            r.min_duration,
            r.max_duration,
            r.avg_duration,
            r.p50_duration,
            r.p90_duration,
            r.p95_duration,
            r.p99_duration,
            r.total_res_bytes,
            r.status_2xx,
            r.status_3xx,
            r.status_4xx,
            r.status_5xx,
          );
          totalRequests += r.request_count;
          totalErrors += r.error_count;
        }
        if (totalRequests > 0 || totalErrors > 0) {
          if (totalRequests !== 0) {
            this.stmts.incrementSetting.run(
              LIFETIME_TOTAL_REQUESTS_KEY,
              String(totalRequests),
            );
          }
          if (totalErrors !== 0) {
            this.stmts.incrementSetting.run(
              LIFETIME_TOTAL_ERRORS_KEY,
              String(totalErrors),
            );
          }
        }
      });
      batchInsert(rows);
    } catch (err) {
      logDbError("SQLite insertEndpointMetricsBatch", err);
    }
  }

  insertError(e: ErrorLogRow): void {
    try {
      this.stmts.insertError.run(
        e.timestamp,
        e.instance_id ?? null,
        e.method,
        e.path,
        e.status_code,
        e.error_msg,
        e.stack_trace,
        e.duration_ms,
      );
    } catch (err) {
      logDbError("SQLite insertError", err);
    }
  }

  insertErrorsBatch(errors: ErrorLogRow[]): void {
    if (errors.length === 0) return;
    try {
      const batchInsert = this.db.transaction((rows: ErrorLogRow[]) => {
        for (const e of rows) {
          this.stmts.insertError.run(
            e.timestamp,
            e.instance_id ?? null,
            e.method,
            e.path,
            e.status_code,
            e.error_msg,
            e.stack_trace,
            e.duration_ms,
          );
        }
      });
      batchInsert(errors);
    } catch (err) {
      logDbError("SQLite insertErrorsBatch", err);
    }
  }

  insertSystemAndProcessMetrics(
    system: SystemMetricRow,
    process: ProcessMetricRow,
  ): void {
    try {
      const insert = this.db.transaction(() => {
        this.stmts.insertSystem.run(
          system.timestamp,
          system.instance_id ?? null,
          system.cpu_percent,
          system.mem_total,
          system.mem_used,
          system.mem_percent,
          system.disk_total,
          system.disk_used,
          system.disk_percent,
          system.net_rx_bytes,
          system.net_tx_bytes,
        );
        this.stmts.insertProcess.run(
          process.timestamp,
          process.instance_id ?? null,
          process.heap_used,
          process.heap_total,
          process.external_mem,
          process.event_loop_avg_ms,
          process.event_loop_max_ms,
          process.gc_pause_ms,
          process.uptime_seconds,
        );
      });
      insert();
    } catch (err) {
      logDbError("SQLite insertSystemAndProcessMetrics", err);
    }
  }

  // ─── Queries ────────────────────────────────────────────────────────────

  async getSystemMetrics(
    range: TimeRange,
    maxPoints?: number,
    options?: MetricsQueryOptions,
  ): Promise<SystemMetricRow[]> {
    const sampleSize = ensureSampleSize(maxPoints);
    const instanceFilter = instanceFilterSql(options);

    if (options?.clusterAggregate) {
      const span = Math.max(range.to - range.from, 1);
      const bucketMs = sampleSize
        ? Math.max(Math.floor(span / sampleSize), 1)
        : span;

      const sql = `
        SELECT
          MAX(timestamp) as timestamp,
          AVG(cpu_percent) as cpu_percent,
          AVG(mem_total) as mem_total,
          SUM(mem_used) as mem_used,
          AVG(mem_percent) as mem_percent,
          AVG(disk_total) as disk_total,
          AVG(disk_used) as disk_used,
          AVG(disk_percent) as disk_percent,
          SUM(net_rx_bytes) as net_rx_bytes,
          SUM(net_tx_bytes) as net_tx_bytes
        FROM (
          SELECT
            CAST((timestamp - ?) / ? AS INTEGER) as bucket,
            MAX(timestamp) as timestamp,
            AVG(cpu_percent) as cpu_percent,
            AVG(mem_total) as mem_total,
            AVG(mem_used) as mem_used,
            AVG(mem_percent) as mem_percent,
            AVG(disk_total) as disk_total,
            AVG(disk_used) as disk_used,
            AVG(disk_percent) as disk_percent,
            AVG(net_rx_bytes) as net_rx_bytes,
            AVG(net_tx_bytes) as net_tx_bytes
          FROM ${TABLE_SYSTEM_METRICS}
          WHERE timestamp BETWEEN ? AND ?
          GROUP BY bucket, COALESCE(instance_id, '${LEGACY_INSTANCE_ID}')
        )
        GROUP BY bucket
        ORDER BY timestamp ASC
      `;
      const rows = this.db
        .prepare(sql)
        .all(range.from, bucketMs, range.from, range.to) as Array<
        Omit<SystemMetricRow, "mem_total" | "mem_used" | "net_rx_bytes" | "net_tx_bytes"> & {
          mem_total: number;
          mem_used: number;
          net_rx_bytes: number;
          net_tx_bytes: number;
        }
      >;
      return rows.map((row) => ({
        ...row,
        mem_total: Math.round(row.mem_total),
        mem_used: Math.round(row.mem_used),
        disk_total: numberOrNull(row.disk_total),
        disk_used: numberOrNull(row.disk_used),
        net_rx_bytes: Math.round(row.net_rx_bytes),
        net_tx_bytes: Math.round(row.net_tx_bytes),
      }));
    }

    if (!sampleSize) {
      const sql = `
        SELECT * FROM ${TABLE_SYSTEM_METRICS}
        WHERE timestamp BETWEEN ? AND ?
        ${instanceFilter.clause}
        ORDER BY timestamp ASC
      `;
      return this.db
        .prepare(sql)
        .all(range.from, range.to, ...instanceFilter.params) as SystemMetricRow[];
    }

    const span = Math.max(range.to - range.from, 1);
    const bucketMs = Math.max(Math.floor(span / sampleSize), 1);
    const sql = `
      SELECT
        MAX(timestamp) as timestamp,
        AVG(cpu_percent) as cpu_percent,
        AVG(mem_total) as mem_total,
        AVG(mem_used) as mem_used,
        AVG(mem_percent) as mem_percent,
        AVG(disk_total) as disk_total,
        AVG(disk_used) as disk_used,
        AVG(disk_percent) as disk_percent,
        AVG(net_rx_bytes) as net_rx_bytes,
        AVG(net_tx_bytes) as net_tx_bytes
      FROM ${TABLE_SYSTEM_METRICS}
      WHERE timestamp BETWEEN ? AND ?
      ${instanceFilter.clause}
      GROUP BY CAST((timestamp - ?) / ? AS INTEGER)
      ORDER BY timestamp ASC
    `;
    const rows = this.db
      .prepare(sql)
      .all(
        range.from,
        range.to,
        ...instanceFilter.params,
        range.from,
        bucketMs,
      ) as Array<
      Omit<SystemMetricRow, "mem_total" | "mem_used" | "net_rx_bytes" | "net_tx_bytes"> & {
        mem_total: number;
        mem_used: number;
        net_rx_bytes: number;
        net_tx_bytes: number;
      }
    >;
    return rows.map((row) => ({
      ...row,
      mem_total: Math.round(row.mem_total),
      mem_used: Math.round(row.mem_used),
      disk_total: numberOrNull(row.disk_total),
      disk_used: numberOrNull(row.disk_used),
      net_rx_bytes: Math.round(row.net_rx_bytes),
      net_tx_bytes: Math.round(row.net_tx_bytes),
    }));
  }

  async getProcessMetrics(
    range: TimeRange,
    maxPoints?: number,
    options?: MetricsQueryOptions,
  ): Promise<ProcessMetricRow[]> {
    const sampleSize = ensureSampleSize(maxPoints);
    const instanceFilter = instanceFilterSql(options);

    if (options?.clusterAggregate) {
      const span = Math.max(range.to - range.from, 1);
      const bucketMs = sampleSize
        ? Math.max(Math.floor(span / sampleSize), 1)
        : span;

      const sql = `
        SELECT
          MAX(timestamp) as timestamp,
          SUM(heap_used) as heap_used,
          SUM(heap_total) as heap_total,
          SUM(external_mem) as external_mem,
          AVG(event_loop_avg_ms) as event_loop_avg_ms,
          MAX(event_loop_max_ms) as event_loop_max_ms,
          AVG(gc_pause_ms) as gc_pause_ms,
          MAX(uptime_seconds) as uptime_seconds
        FROM (
          SELECT
            CAST((timestamp - ?) / ? AS INTEGER) as bucket,
            MAX(timestamp) as timestamp,
            AVG(heap_used) as heap_used,
            AVG(heap_total) as heap_total,
            AVG(external_mem) as external_mem,
            AVG(event_loop_avg_ms) as event_loop_avg_ms,
            MAX(event_loop_max_ms) as event_loop_max_ms,
            AVG(gc_pause_ms) as gc_pause_ms,
            MAX(uptime_seconds) as uptime_seconds
          FROM ${TABLE_PROCESS_METRICS}
          WHERE timestamp BETWEEN ? AND ?
          GROUP BY bucket, COALESCE(instance_id, '${LEGACY_INSTANCE_ID}')
        )
        GROUP BY bucket
        ORDER BY timestamp ASC
      `;
      const rows = this.db
        .prepare(sql)
        .all(range.from, bucketMs, range.from, range.to) as Array<
        Omit<ProcessMetricRow, "heap_used" | "heap_total" | "external_mem"> & {
          heap_used: number;
          heap_total: number;
          external_mem: number;
        }
      >;
      return rows.map((row) => ({
        ...row,
        heap_used: Math.round(row.heap_used),
        heap_total: Math.round(row.heap_total),
        external_mem: Math.round(row.external_mem),
      }));
    }

    if (!sampleSize) {
      const sql = `
        SELECT * FROM ${TABLE_PROCESS_METRICS}
        WHERE timestamp BETWEEN ? AND ?
        ${instanceFilter.clause}
        ORDER BY timestamp ASC
      `;
      return this.db
        .prepare(sql)
        .all(range.from, range.to, ...instanceFilter.params) as ProcessMetricRow[];
    }

    const span = Math.max(range.to - range.from, 1);
    const bucketMs = Math.max(Math.floor(span / sampleSize), 1);
    const sql = `
      SELECT
        MAX(timestamp) as timestamp,
        AVG(heap_used) as heap_used,
        AVG(heap_total) as heap_total,
        AVG(external_mem) as external_mem,
        AVG(event_loop_avg_ms) as event_loop_avg_ms,
        AVG(event_loop_max_ms) as event_loop_max_ms,
        AVG(gc_pause_ms) as gc_pause_ms,
        AVG(uptime_seconds) as uptime_seconds
      FROM ${TABLE_PROCESS_METRICS}
      WHERE timestamp BETWEEN ? AND ?
      ${instanceFilter.clause}
      GROUP BY CAST((timestamp - ?) / ? AS INTEGER)
      ORDER BY timestamp ASC
    `;
    const rows = this.db
      .prepare(sql)
      .all(
        range.from,
        range.to,
        ...instanceFilter.params,
        range.from,
        bucketMs,
      ) as Array<
      Omit<ProcessMetricRow, "heap_used" | "heap_total" | "external_mem"> & {
        heap_used: number;
        heap_total: number;
        external_mem: number;
      }
    >;
    return rows.map((row) => ({
      ...row,
      heap_used: Math.round(row.heap_used),
      heap_total: Math.round(row.heap_total),
      external_mem: Math.round(row.external_mem),
    }));
  }

  async getLiveOverview(now: number): Promise<LiveOverviewMetrics> {
    const minuteRange = { from: now - 60_000, to: now };

    const minuteSql = `
      SELECT
        COALESCE(SUM(request_count), 0) as total_requests,
        COALESCE(SUM(error_count), 0) as total_errors
      FROM ${TABLE_ENDPOINT_METRICS}
      WHERE timestamp BETWEEN ? AND ?
    `;
    const minuteRow = this.db.prepare(minuteSql).get(minuteRange.from, minuteRange.to) as {
      total_requests: number;
      total_errors: number;
    };

    const totalRequests = minuteRow.total_requests;
    const totalErrors = minuteRow.total_errors;

    return {
      rpm: totalRequests,
      // Derive RPS from the 60s window rather than a single flush window: endpoint
      // rows are written once per aggregation window, so a narrow window sees 0/1/2
      // flushes and makes RPS sawtooth. rpm/60 is the smooth per-second average.
      rps: totalRequests / 60,
      total_requests: totalRequests,
      total_errors: totalErrors,
      error_rate:
        totalRequests > 0
          ? Math.round((totalErrors / totalRequests) * 100 * 100) / 100
          : 0,
    };
  }

  async getLifetimeTotals(): Promise<LifetimeTotals> {
    try {
      const req = this.stmts.getSetting.get(LIFETIME_TOTAL_REQUESTS_KEY) as
        | { value: string }
        | undefined;
      const err = this.stmts.getSetting.get(LIFETIME_TOTAL_ERRORS_KEY) as
        | { value: string }
        | undefined;
      return {
        total_requests: parseInt(req?.value ?? "0", 10) || 0,
        total_errors: parseInt(err?.value ?? "0", 10) || 0,
      };
    } catch (err) {
      logDbError("SQLite getLifetimeTotals", err);
      return { total_requests: 0, total_errors: 0 };
    }
  }

  incrementLifetimeTotals(requests: number, errors: number): void {
    if (requests === 0 && errors === 0) return;
    try {
      const bump = this.db.transaction(() => {
        if (requests !== 0) {
          this.stmts.incrementSetting.run(
            LIFETIME_TOTAL_REQUESTS_KEY,
            String(requests),
          );
        }
        if (errors !== 0) {
          this.stmts.incrementSetting.run(
            LIFETIME_TOTAL_ERRORS_KEY,
            String(errors),
          );
        }
      });
      bump();
    } catch (err) {
      logDbError("SQLite incrementLifetimeTotals", err);
    }
  }

  async getClusterSystemLive(lookbackMs: number): Promise<SystemMetricRow | null> {
    const since = Date.now() - lookbackMs;
    const sql = `
      SELECT s.*
      FROM ${TABLE_SYSTEM_METRICS} s
      INNER JOIN (
        SELECT COALESCE(instance_id, '${LEGACY_INSTANCE_ID}') as iid, MAX(timestamp) as max_ts
        FROM ${TABLE_SYSTEM_METRICS}
        WHERE timestamp >= ?
        GROUP BY iid
      ) latest
        ON COALESCE(s.instance_id, '${LEGACY_INSTANCE_ID}') = latest.iid
        AND s.timestamp = latest.max_ts
      WHERE s.timestamp >= ?
    `;
    const rows = this.db.prepare(sql).all(since, since) as SystemMetricRow[];
    if (rows.length === 0) return null;
    return aggregateSystemRows(rows);
  }

  async getClusterProcessLive(lookbackMs: number): Promise<ProcessMetricRow | null> {
    const since = Date.now() - lookbackMs;
    const sql = `
      SELECT p.*
      FROM ${TABLE_PROCESS_METRICS} p
      INNER JOIN (
        SELECT COALESCE(instance_id, '${LEGACY_INSTANCE_ID}') as iid, MAX(timestamp) as max_ts
        FROM ${TABLE_PROCESS_METRICS}
        WHERE timestamp >= ?
        GROUP BY iid
      ) latest
        ON COALESCE(p.instance_id, '${LEGACY_INSTANCE_ID}') = latest.iid
        AND p.timestamp = latest.max_ts
      WHERE p.timestamp >= ?
    `;
    const rows = this.db.prepare(sql).all(since, since) as ProcessMetricRow[];
    if (rows.length === 0) return null;
    return aggregateProcessRows(rows);
  }

  async listInstances(range: TimeRange): Promise<string[]> {
    const sql = `
      SELECT DISTINCT COALESCE(instance_id, '${LEGACY_INSTANCE_ID}') as instance_id
      FROM (
        SELECT instance_id FROM ${TABLE_SYSTEM_METRICS} WHERE timestamp BETWEEN ? AND ?
        UNION
        SELECT instance_id FROM ${TABLE_PROCESS_METRICS} WHERE timestamp BETWEEN ? AND ?
        UNION
        SELECT instance_id FROM ${TABLE_ENDPOINT_METRICS} WHERE timestamp BETWEEN ? AND ?
      )
      ORDER BY instance_id ASC
      LIMIT ?
    `;
    const rows = this.db
      .prepare(sql)
      .all(
        range.from,
        range.to,
        range.from,
        range.to,
        range.from,
        range.to,
        MAX_INSTANCES_LIST,
      ) as { instance_id: string }[];
    return rows.map((r) => r.instance_id);
  }

  async countInstances(range: TimeRange): Promise<number> {
    const sql = `
      SELECT COUNT(DISTINCT COALESCE(instance_id, '${LEGACY_INSTANCE_ID}')) as count
      FROM ${TABLE_ENDPOINT_METRICS}
      WHERE timestamp BETWEEN ? AND ?
    `;
    const row = this.db.prepare(sql).get(range.from, range.to) as {
      count: number;
    };
    return row.count;
  }

  async getEndpointMetrics(
    range: TimeRange,
    filter?: QueryFilter,
  ): Promise<EndpointMetricRow[]> {
    const search = normalizedSearch(filter?.search);
    if (!search) {
      return this.stmts.getEndpoints.all(
        range.from,
        range.to,
      ) as EndpointMetricRow[];
    }
    const sql = `
      SELECT * FROM ${TABLE_ENDPOINT_METRICS}
      WHERE timestamp BETWEEN ? AND ?
        AND (LOWER(method) LIKE ?${LIKE_ESCAPE} OR LOWER(path) LIKE ?${LIKE_ESCAPE})
      ORDER BY timestamp ASC
    `;
    return this.db.prepare(sql).all(range.from, range.to, search, search) as EndpointMetricRow[];
  }

  async getTopEndpoints(
    metric: TopEndpointMetric,
    limit: number,
    range: TimeRange,
    filter?: QueryFilter,
  ): Promise<TopEndpointRow[]> {
    let orderExpr: string;
    switch (metric) {
      case "request_count":
        orderExpr = "SUM(request_count)";
        break;
      case "avg_duration":
        orderExpr = "SUM(total_duration) / NULLIF(SUM(request_count), 0)";
        break;
      case "p95_duration":
        orderExpr = "AVG(p95_duration)";
        break;
      case "error_rate":
        orderExpr =
          "CAST(SUM(error_count) AS REAL) / NULLIF(SUM(request_count), 0)";
        break;
      case "total_res_bytes":
        orderExpr = "SUM(total_res_bytes)";
        break;
    }

    const search = normalizedSearch(filter?.search);
    const whereFilter = search
      ? `AND (LOWER(method) LIKE ?${LIKE_ESCAPE} OR LOWER(path) LIKE ?${LIKE_ESCAPE})`
      : "";
    const sql = `
      SELECT method, path, ${orderExpr} as value
      FROM ${TABLE_ENDPOINT_METRICS}
      WHERE timestamp BETWEEN ? AND ?
      ${whereFilter}
      GROUP BY method, path
      ORDER BY value DESC
      LIMIT ?
    `;
    const params = search
      ? [range.from, range.to, search, search, limit]
      : [range.from, range.to, limit];
    return this.db.prepare(sql).all(...params) as TopEndpointRow[];
  }

  async getSlowRequests(
    thresholdMs: number,
    range: TimeRange,
    filter?: QueryFilter,
  ): Promise<EndpointMetricRow[]> {
    const search = normalizedSearch(filter?.search);
    const whereFilter = search
      ? `AND (LOWER(method) LIKE ?${LIKE_ESCAPE} OR LOWER(path) LIKE ?${LIKE_ESCAPE})`
      : "";
    const sql = `
      SELECT * FROM ${TABLE_ENDPOINT_METRICS}
      WHERE timestamp BETWEEN ? AND ? AND avg_duration > ?
      ${whereFilter}
      ORDER BY avg_duration DESC
    `;
    const params = search
      ? [range.from, range.to, thresholdMs, search, search]
      : [range.from, range.to, thresholdMs];
    return this.db.prepare(sql).all(...params) as EndpointMetricRow[];
  }

  async getErrorLog(
    range: TimeRange,
    filter?: QueryFilter,
  ): Promise<ErrorLogRow[]> {
    const search = normalizedSearch(filter?.search);
    const status = parseStatusFilter(filter?.status);
    if (!search) {
      if (!status.clause) {
        return this.stmts.getErrors.all(range.from, range.to) as ErrorLogRow[];
      }
      const sql = `
        SELECT * FROM ${TABLE_ERROR_LOG}
        WHERE timestamp BETWEEN ? AND ?
        ${status.clause}
        ORDER BY timestamp DESC
      `;
      return this.db
        .prepare(sql)
        .all(range.from, range.to, ...status.params) as ErrorLogRow[];
    }
    const sql = `
      SELECT * FROM ${TABLE_ERROR_LOG}
      WHERE timestamp BETWEEN ? AND ?
        ${status.clause}
        AND (
          LOWER(method) LIKE ?${LIKE_ESCAPE}
          OR LOWER(path) LIKE ?${LIKE_ESCAPE}
          OR LOWER(COALESCE(error_msg, '')) LIKE ?${LIKE_ESCAPE}
        )
      ORDER BY timestamp DESC
    `;
    return this.db
      .prepare(sql)
      .all(
        range.from,
        range.to,
        ...status.params,
        search,
        search,
        search,
      ) as ErrorLogRow[];
  }

  async getErrorStatusCodes(range: TimeRange): Promise<number[]> {
    const sql = `
      SELECT DISTINCT status_code as code
      FROM ${TABLE_ERROR_LOG}
      WHERE timestamp BETWEEN ? AND ?
      ORDER BY status_code ASC
    `;
    const rows = this.db
      .prepare(sql)
      .all(range.from, range.to) as { code: number }[];
    return rows.map((r) => r.code);
  }

  async getStatusDistribution(range: TimeRange): Promise<StatusDistribution> {
    const sql = `
      SELECT
        COALESCE(SUM(status_2xx), 0) as status_2xx,
        COALESCE(SUM(status_3xx), 0) as status_3xx,
        COALESCE(SUM(status_4xx), 0) as status_4xx,
        COALESCE(SUM(status_5xx), 0) as status_5xx
      FROM ${TABLE_ENDPOINT_METRICS}
      WHERE timestamp BETWEEN ? AND ?
    `;
    return this.db.prepare(sql).get(range.from, range.to) as StatusDistribution;
  }

  async getOverview(range: TimeRange): Promise<OverviewMetrics> {
    const sql = `
      SELECT
        COALESCE(SUM(request_count), 0) as total_requests,
        COALESCE(SUM(error_count), 0) as total_errors,
        CASE WHEN SUM(request_count) > 0
          THEN CAST(SUM(error_count) AS REAL) / SUM(request_count) * 100
          ELSE 0
        END as error_rate,
        CASE WHEN SUM(request_count) > 0
          THEN SUM(total_duration) / SUM(request_count)
          ELSE 0
        END as avg_duration,
        COALESCE(MAX(p95_duration), 0) as p95_duration,
        COALESCE(MAX(p99_duration), 0) as p99_duration
      FROM ${TABLE_ENDPOINT_METRICS}
      WHERE timestamp BETWEEN ? AND ?
    `;
    const row = this.db.prepare(sql).get(range.from, range.to) as {
      total_requests: number;
      total_errors: number;
      error_rate: number;
      avg_duration: number;
      p95_duration: number;
      p99_duration: number;
    };
    return withRpsRpm(range, row);
  }

  // ─── Paginated Queries ──────────────────────────────────────────────────

  async getSystemMetricsPaginated(
    range: TimeRange,
    pagination: PaginationParams,
    _maxPoints?: number,
    options?: MetricsQueryOptions,
  ): Promise<PaginatedResult<SystemMetricRow>> {
    const instanceFilter = instanceFilterSql(options);
    const countSql = `
      SELECT COUNT(*) as count FROM ${TABLE_SYSTEM_METRICS}
      WHERE timestamp BETWEEN ? AND ?
      ${instanceFilter.clause}
    `;
    const { count } = this.db
      .prepare(countSql)
      .get(range.from, range.to, ...instanceFilter.params) as { count: number };
    const offset = (pagination.page - 1) * pagination.limit;
    const dataSql = `
      SELECT * FROM ${TABLE_SYSTEM_METRICS}
      WHERE timestamp BETWEEN ? AND ?
      ${instanceFilter.clause}
      ORDER BY timestamp ASC
      LIMIT ? OFFSET ?
    `;
    const data = this.db
      .prepare(dataSql)
      .all(
        range.from,
        range.to,
        ...instanceFilter.params,
        pagination.limit,
        offset,
      ) as SystemMetricRow[];
    return buildPaginatedResult(data, count, pagination);
  }

  async getProcessMetricsPaginated(
    range: TimeRange,
    pagination: PaginationParams,
    _maxPoints?: number,
    options?: MetricsQueryOptions,
  ): Promise<PaginatedResult<ProcessMetricRow>> {
    const instanceFilter = instanceFilterSql(options);
    const countSql = `
      SELECT COUNT(*) as count FROM ${TABLE_PROCESS_METRICS}
      WHERE timestamp BETWEEN ? AND ?
      ${instanceFilter.clause}
    `;
    const { count } = this.db
      .prepare(countSql)
      .get(range.from, range.to, ...instanceFilter.params) as { count: number };
    const offset = (pagination.page - 1) * pagination.limit;
    const dataSql = `
      SELECT * FROM ${TABLE_PROCESS_METRICS}
      WHERE timestamp BETWEEN ? AND ?
      ${instanceFilter.clause}
      ORDER BY timestamp ASC
      LIMIT ? OFFSET ?
    `;
    const data = this.db
      .prepare(dataSql)
      .all(
        range.from,
        range.to,
        ...instanceFilter.params,
        pagination.limit,
        offset,
      ) as ProcessMetricRow[];
    return buildPaginatedResult(data, count, pagination);
  }

  async getEndpointMetricsPaginated(
    range: TimeRange,
    pagination: PaginationParams,
    filter?: QueryFilter,
  ): Promise<PaginatedResult<EndpointMetricRow>> {
    const search = normalizedSearch(filter?.search);
    const countSql = search
      ? `SELECT COUNT(*) as count FROM ${TABLE_ENDPOINT_METRICS} WHERE timestamp BETWEEN ? AND ? AND (LOWER(method) LIKE ?${LIKE_ESCAPE} OR LOWER(path) LIKE ?${LIKE_ESCAPE})`
      : `SELECT COUNT(*) as count FROM ${TABLE_ENDPOINT_METRICS} WHERE timestamp BETWEEN ? AND ?`;
    const countParams = search
      ? [range.from, range.to, search, search]
      : [range.from, range.to];
    const { count } = this.db.prepare(countSql).get(...countParams) as { count: number };
    const offset = (pagination.page - 1) * pagination.limit;
    const dataSql = search
      ? `SELECT * FROM ${TABLE_ENDPOINT_METRICS} WHERE timestamp BETWEEN ? AND ? AND (LOWER(method) LIKE ?${LIKE_ESCAPE} OR LOWER(path) LIKE ?${LIKE_ESCAPE}) ORDER BY timestamp ASC LIMIT ? OFFSET ?`
      : `SELECT * FROM ${TABLE_ENDPOINT_METRICS} WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp ASC LIMIT ? OFFSET ?`;
    const dataParams = search
      ? [range.from, range.to, search, search, pagination.limit, offset]
      : [range.from, range.to, pagination.limit, offset];
    const data = this.db.prepare(dataSql).all(...dataParams) as EndpointMetricRow[];
    return buildPaginatedResult(data, count, pagination);
  }

  async getSlowRequestsPaginated(
    thresholdMs: number,
    range: TimeRange,
    pagination: PaginationParams,
    filter?: QueryFilter,
  ): Promise<PaginatedResult<EndpointMetricRow>> {
    const search = normalizedSearch(filter?.search);
    const whereFilter = search
      ? `AND (LOWER(method) LIKE ?${LIKE_ESCAPE} OR LOWER(path) LIKE ?${LIKE_ESCAPE})`
      : "";
    const countSql = `
      SELECT COUNT(*) as count FROM ${TABLE_ENDPOINT_METRICS}
      WHERE timestamp BETWEEN ? AND ? AND avg_duration > ?
      ${whereFilter}
    `;
    const countParams = search
      ? [range.from, range.to, thresholdMs, search, search]
      : [range.from, range.to, thresholdMs];
    const { count } = this.db.prepare(countSql).get(...countParams) as { count: number };
    const offset = (pagination.page - 1) * pagination.limit;
    const dataSql = `
      SELECT * FROM ${TABLE_ENDPOINT_METRICS}
      WHERE timestamp BETWEEN ? AND ? AND avg_duration > ?
      ${whereFilter}
      ORDER BY avg_duration DESC
      LIMIT ? OFFSET ?
    `;
    const dataParams = search
      ? [range.from, range.to, thresholdMs, search, search, pagination.limit, offset]
      : [range.from, range.to, thresholdMs, pagination.limit, offset];
    const data = this.db.prepare(dataSql).all(...dataParams) as EndpointMetricRow[];
    return buildPaginatedResult(data, count, pagination);
  }

  async getErrorLogPaginated(
    range: TimeRange,
    pagination: PaginationParams,
    filter?: QueryFilter,
  ): Promise<PaginatedResult<ErrorLogRow>> {
    const search = normalizedSearch(filter?.search);
    const status = parseStatusFilter(filter?.status);
    const whereFilter = search
      ? `AND (LOWER(method) LIKE ?${LIKE_ESCAPE} OR LOWER(path) LIKE ?${LIKE_ESCAPE} OR LOWER(COALESCE(error_msg, '')) LIKE ?${LIKE_ESCAPE})`
      : "";
    const statusFilter = status.clause ? ` ${status.clause}` : "";
    const countSql = `
      SELECT COUNT(*) as count FROM ${TABLE_ERROR_LOG}
      WHERE timestamp BETWEEN ? AND ?
      ${statusFilter}
      ${whereFilter}
    `;
    const countParams = search
      ? [range.from, range.to, ...status.params, search, search, search]
      : [range.from, range.to, ...status.params];
    const { count } = this.db.prepare(countSql).get(...countParams) as { count: number };
    const offset = (pagination.page - 1) * pagination.limit;
    const dataSql = `
      SELECT * FROM ${TABLE_ERROR_LOG}
      WHERE timestamp BETWEEN ? AND ?
      ${statusFilter}
      ${whereFilter}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `;
    const dataParams = search
      ? [range.from, range.to, ...status.params, search, search, search, pagination.limit, offset]
      : [range.from, range.to, ...status.params, pagination.limit, offset];
    const data = this.db.prepare(dataSql).all(...dataParams) as ErrorLogRow[];
    return buildPaginatedResult(data, count, pagination);
  }

  // ─── Maintenance ────────────────────────────────────────────────────────

  deleteOlderThan(timestamp: number): void {
    try {
      const cleanup = this.db.transaction(() => {
        this.stmts.deleteSystemOlder.run(timestamp);
        this.stmts.deleteProcessOlder.run(timestamp);
        this.stmts.deleteEndpointOlder.run(timestamp);
        this.stmts.deleteErrorOlder.run(timestamp);
      });
      cleanup();
    } catch (err) {
      logDbError("SQLite deleteOlderThan", err);
    }
  }

  // ─── Settings ───────────────────────────────────────────────────────────

  async getSetting(key: string): Promise<string | null> {
    try {
      const row = this.stmts.getSetting.get(key) as
        | { value: string }
        | undefined;
      return row?.value ?? null;
    } catch (err) {
      logDbError("SQLite getSetting", err);
      return null;
    }
  }

  setSetting(key: string, value: string): void {
    try {
      this.stmts.setSetting.run(key, value);
    } catch (err) {
      logDbError("SQLite setSetting", err);
    }
  }

  // ─── Auth ───────────────────────────────────────────────────────────────

  async getUser(
    username: string,
  ): Promise<{ username: string; password_hash: string } | null> {
    try {
      const row = this.stmts.getUser.get(username) as
        | { username: string; password_hash: string }
        | undefined;
      return row ?? null;
    } catch (err) {
      logDbError("SQLite getUser", err);
      return null;
    }
  }

  async hasAnyUser(): Promise<boolean> {
    try {
      const row = this.db
        .prepare(`SELECT 1 AS ok FROM ${TABLE_AUTH} LIMIT 1`)
        .get() as { ok: number } | undefined;
      return row != null;
    } catch (err) {
      logDbError("SQLite hasAnyUser", err);
      return false;
    }
  }

  createUser(username: string, passwordHash: string): void {
    try {
      this.stmts.createUser.run(username, passwordHash, Date.now());
    } catch (err) {
      logDbError("SQLite createUser", err);
    }
  }

  updateUserPassword(username: string, passwordHash: string): void {
    try {
      this.stmts.updateUserPassword.run(passwordHash, username);
    } catch (err) {
      logDbError("SQLite updateUserPassword", err);
    }
  }
}
