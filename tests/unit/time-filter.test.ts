import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SQLiteAdapter } from "../../src/db/sqlite.js";
import type {
  SystemMetricRow,
  EndpointMetricRow,
  ErrorLogRow,
  ProcessMetricRow,
} from "../../src/types.js";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * Time-filter tests: inserts 30 days of artificial data, then verifies that
 * every query method returns only the rows that fall within the requested
 * time range — matching how the frontend's TimeRangeSelector drives the API.
 */

const DB_PATH = path.join(
  os.tmpdir(),
  `loadflux-time-filter-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);

const NOW = Date.now();
const ONE_HOUR = 3_600_000;
const ONE_DAY = 86_400_000;

// Anchored reference point: "now" for all data generation
// Data is inserted from (NOW - 30 days) to NOW, one row per hour = 720 rows per table
const TOTAL_DAYS = 30;
const ROWS_PER_DAY = 24; // one per hour
const TOTAL_ROWS = TOTAL_DAYS * ROWS_PER_DAY; // 720

// Pre-computed timestamps: index 0 = oldest (30 days ago), index 719 = newest (~now)
const timestamps: number[] = [];
for (let i = 0; i < TOTAL_ROWS; i++) {
  timestamps.push(NOW - (TOTAL_ROWS - 1 - i) * ONE_HOUR);
}

// ── Helpers to build deterministic rows ────────────────────────────────────

function makeSystemRow(ts: number, idx: number): SystemMetricRow {
  return {
    timestamp: ts,
    cpu_percent: 10 + (idx % 80), // 10–89, deterministic
    mem_total: 16_000_000_000,
    mem_used: 4_000_000_000 + idx * 1_000_000,
    mem_percent: 25 + (idx % 50),
    disk_total: 500_000_000_000,
    disk_used: 200_000_000_000,
    disk_percent: 40,
    net_rx_bytes: idx * 100,
    net_tx_bytes: idx * 50,
  };
}

function makeProcessRow(ts: number, idx: number): ProcessMetricRow {
  return {
    timestamp: ts,
    heap_used: 30_000_000 + idx * 10_000,
    heap_total: 100_000_000,
    external_mem: 5_000_000,
    event_loop_avg_ms: 1 + (idx % 10) * 0.5,
    event_loop_max_ms: 5 + (idx % 20),
    gc_pause_ms: 0.1 * (idx % 5),
    uptime_seconds: idx * 3600,
  };
}

function makeEndpointRow(
  ts: number,
  idx: number,
  method: string,
  routePath: string,
): EndpointMetricRow {
  const base = idx + 1;
  return {
    timestamp: ts,
    method,
    path: routePath,
    request_count: base * 10,
    error_count: base % 5 === 0 ? base : 0,
    total_duration: base * 50,
    min_duration: 5,
    max_duration: 100 + base,
    avg_duration: 20 + (base % 30),
    p50_duration: 18 + (base % 25),
    p90_duration: 60 + (base % 40),
    p95_duration: 80 + (base % 20),
    p99_duration: 95 + (base % 10),
    total_res_bytes: base * 500,
    status_2xx: base * 8,
    status_3xx: 0,
    status_4xx: base % 5 === 0 ? base : 0,
    status_5xx: base % 10 === 0 ? 1 : 0,
  };
}

function makeErrorRow(ts: number, idx: number): ErrorLogRow {
  return {
    timestamp: ts,
    method: "GET",
    path: "/api/fail",
    status_code: idx % 2 === 0 ? 500 : 400,
    error_msg: `Error at index ${idx}`,
    stack_trace: null,
    duration_ms: 50 + idx,
  };
}

// ── Count helpers ──────────────────────────────────────────────────────────

function countInRange(from: number, to: number): number {
  return timestamps.filter((t) => t >= from && t <= to).length;
}

function indicesInRange(from: number, to: number): number[] {
  return timestamps
    .map((t, i) => (t >= from && t <= to ? i : -1))
    .filter((i) => i >= 0);
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe("Time-range filtering (30 days of artificial data)", () => {
  let db: SQLiteAdapter;

  beforeAll(async () => {
    db = new SQLiteAdapter(DB_PATH);
    await db.connect();

    // Bulk-insert 30 days of data
    for (let i = 0; i < TOTAL_ROWS; i++) {
      const ts = timestamps[i];
      db.insertSystemMetrics(makeSystemRow(ts, i));
      db.insertProcessMetrics(makeProcessRow(ts, i));
      db.insertEndpointMetricsBatch([
        makeEndpointRow(ts, i, "GET", "/api/users"),
        makeEndpointRow(ts, i, "POST", "/api/orders"),
      ]);
      // Insert an error every 12 hours (60 errors over 30 days)
      if (i % 12 === 0) {
        db.insertError(makeErrorRow(ts, i));
      }
    }
  });

  afterAll(async () => {
    await db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(DB_PATH + suffix);
      } catch {}
    }
  });

  // ── System metrics ───────────────────────────────────────────────────────

  describe("getSystemMetrics", () => {
    it("returns only rows within a 1-hour window", async () => {
      const from = NOW - ONE_HOUR;
      const to = NOW;
      const rows = await db.getSystemMetrics({ from, to });
      const expected = countInRange(from, to);
      expect(rows.length).toBe(expected);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.timestamp).toBeGreaterThanOrEqual(from);
        expect(r.timestamp).toBeLessThanOrEqual(to);
      }
    });

    it("returns only rows within a 24-hour window", async () => {
      const from = NOW - ONE_DAY;
      const to = NOW;
      const rows = await db.getSystemMetrics({ from, to });
      const expected = countInRange(from, to);
      expect(rows.length).toBe(expected);
      expect(expected).toBe(ROWS_PER_DAY + 1); // 25 rows (hours 0..24 inclusive at boundaries)
    });

    it("returns only rows within a 7-day window", async () => {
      const from = NOW - 7 * ONE_DAY;
      const to = NOW;
      const rows = await db.getSystemMetrics({ from, to });
      const expected = countInRange(from, to);
      expect(rows.length).toBe(expected);
      expect(rows.length).toBeGreaterThan(7 * ROWS_PER_DAY - 1);
    });

    it("returns all 720 rows for the full 30-day window", async () => {
      const from = NOW - 30 * ONE_DAY;
      const to = NOW;
      const rows = await db.getSystemMetrics({ from, to });
      expect(rows.length).toBe(TOTAL_ROWS);
    });

    it("returns 0 rows for a range in the future", async () => {
      const from = NOW + ONE_DAY;
      const to = NOW + 2 * ONE_DAY;
      const rows = await db.getSystemMetrics({ from, to });
      expect(rows.length).toBe(0);
    });

    it("returns 0 rows for a range before any data", async () => {
      const from = NOW - 60 * ONE_DAY;
      const to = NOW - 31 * ONE_DAY;
      const rows = await db.getSystemMetrics({ from, to });
      expect(rows.length).toBe(0);
    });

    it("returns rows ordered by timestamp ASC", async () => {
      const rows = await db.getSystemMetrics({
        from: NOW - 30 * ONE_DAY,
        to: NOW,
      });
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].timestamp).toBeGreaterThanOrEqual(rows[i - 1].timestamp);
      }
    });
  });

  // ── Process metrics ──────────────────────────────────────────────────────

  describe("getProcessMetrics", () => {
    it("returns only rows within a 6-hour window", async () => {
      const from = NOW - 6 * ONE_HOUR;
      const to = NOW;
      const rows = await db.getProcessMetrics({ from, to });
      const expected = countInRange(from, to);
      expect(rows.length).toBe(expected);
      for (const r of rows) {
        expect(r.timestamp).toBeGreaterThanOrEqual(from);
        expect(r.timestamp).toBeLessThanOrEqual(to);
      }
    });

    it("returns all rows for 30-day window", async () => {
      const rows = await db.getProcessMetrics({
        from: NOW - 30 * ONE_DAY,
        to: NOW,
      });
      expect(rows.length).toBe(TOTAL_ROWS);
    });

    it("returns 0 rows for empty range", async () => {
      const rows = await db.getProcessMetrics({
        from: NOW + ONE_DAY,
        to: NOW + 2 * ONE_DAY,
      });
      expect(rows.length).toBe(0);
    });
  });

  // ── Endpoint metrics ─────────────────────────────────────────────────────

  describe("getEndpointMetrics", () => {
    it("returns only endpoint rows within a 1-hour window", async () => {
      const from = NOW - ONE_HOUR;
      const to = NOW;
      const rows = await db.getEndpointMetrics({ from, to });
      const expectedTimestamps = countInRange(from, to);
      // 2 routes per timestamp
      expect(rows.length).toBe(expectedTimestamps * 2);
      for (const r of rows) {
        expect(r.timestamp).toBeGreaterThanOrEqual(from);
        expect(r.timestamp).toBeLessThanOrEqual(to);
      }
    });

    it("returns only endpoint rows within a 7-day window", async () => {
      const from = NOW - 7 * ONE_DAY;
      const to = NOW;
      const rows = await db.getEndpointMetrics({ from, to });
      const expectedTimestamps = countInRange(from, to);
      expect(rows.length).toBe(expectedTimestamps * 2);
    });

    it("returns all endpoint rows for 30-day window", async () => {
      const rows = await db.getEndpointMetrics({
        from: NOW - 30 * ONE_DAY,
        to: NOW,
      });
      expect(rows.length).toBe(TOTAL_ROWS * 2); // 1440
    });

    it("a mid-range window excludes data outside the range", async () => {
      // Pick a 3-day window in the middle: days 10–13
      const from = NOW - 20 * ONE_DAY;
      const to = NOW - 17 * ONE_DAY;
      const rows = await db.getEndpointMetrics({ from, to });
      const expectedTimestamps = countInRange(from, to);
      expect(rows.length).toBe(expectedTimestamps * 2);
      expect(rows.length).toBeGreaterThan(0);

      // Verify no rows leak from outside
      for (const r of rows) {
        expect(r.timestamp).toBeGreaterThanOrEqual(from);
        expect(r.timestamp).toBeLessThanOrEqual(to);
      }
    });
  });

  // ── Error log ────────────────────────────────────────────────────────────

  describe("getErrorLog", () => {
    it("returns only errors within a 24-hour window", async () => {
      const from = NOW - ONE_DAY;
      const to = NOW;
      const rows = await db.getErrorLog({ from, to });
      for (const r of rows) {
        expect(r.timestamp).toBeGreaterThanOrEqual(from);
        expect(r.timestamp).toBeLessThanOrEqual(to);
      }
      // Errors every 12 hours → expect ~2 in a 24h window
      expect(rows.length).toBeLessThanOrEqual(3);
    });

    it("returns all errors for 30-day window", async () => {
      const rows = await db.getErrorLog({
        from: NOW - 30 * ONE_DAY,
        to: NOW,
      });
      // Total errors = TOTAL_ROWS / 12 = 60
      expect(rows.length).toBe(Math.ceil(TOTAL_ROWS / 12));
    });

    it("returns errors ordered by timestamp DESC", async () => {
      const rows = await db.getErrorLog({
        from: NOW - 30 * ONE_DAY,
        to: NOW,
      });
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].timestamp).toBeLessThanOrEqual(rows[i - 1].timestamp);
      }
    });

    it("returns 0 errors for a range with no error data", async () => {
      // Pick a 1-hour window that falls between two error insertion points
      // Errors are at indices 0, 12, 24... (every 12 hours)
      // Pick a window around index 6 (6 hours from the start of data)
      const midTs = timestamps[6];
      const rows = await db.getErrorLog({
        from: midTs - 100,
        to: midTs + 100,
      });
      expect(rows.length).toBe(0);
    });
  });

  // ── Top endpoints ────────────────────────────────────────────────────────

  describe("getTopEndpoints", () => {
    it("aggregates only within the requested time range", async () => {
      const from = NOW - ONE_DAY;
      const to = NOW;
      const top = await db.getTopEndpoints("request_count", 10, { from, to });

      expect(top.length).toBe(2); // GET /api/users and POST /api/orders
      // The values should reflect only the last-24h data, not all 30 days
      const fullRange = await db.getTopEndpoints("request_count", 10, {
        from: NOW - 30 * ONE_DAY,
        to: NOW,
      });
      // 30-day totals must be larger than 1-day totals
      const dayTotal = top.reduce((s, r) => s + r.value, 0);
      const fullTotal = fullRange.reduce((s, r) => s + r.value, 0);
      expect(fullTotal).toBeGreaterThan(dayTotal);
    });

    it("top by avg_duration works within range", async () => {
      const top = await db.getTopEndpoints("avg_duration", 5, {
        from: NOW - 7 * ONE_DAY,
        to: NOW,
      });
      expect(top.length).toBe(2);
      expect(top[0].value).toBeGreaterThan(0);
    });

    it("top by error_rate works within range", async () => {
      const top = await db.getTopEndpoints("error_rate", 5, {
        from: NOW - 30 * ONE_DAY,
        to: NOW,
      });
      expect(top.length).toBe(2);
    });

    it("returns empty for a range with no data", async () => {
      const top = await db.getTopEndpoints("request_count", 10, {
        from: NOW + ONE_DAY,
        to: NOW + 2 * ONE_DAY,
      });
      expect(top.length).toBe(0);
    });
  });

  // ── Status distribution ──────────────────────────────────────────────────

  describe("getStatusDistribution", () => {
    it("sums status codes only within the time range", async () => {
      const dayDist = await db.getStatusDistribution({
        from: NOW - ONE_DAY,
        to: NOW,
      });
      const fullDist = await db.getStatusDistribution({
        from: NOW - 30 * ONE_DAY,
        to: NOW,
      });
      // 30-day totals should be greater than or equal to 1-day totals
      expect(fullDist.status_2xx).toBeGreaterThanOrEqual(dayDist.status_2xx);
      expect(fullDist.status_4xx).toBeGreaterThanOrEqual(dayDist.status_4xx);
      expect(fullDist.status_5xx).toBeGreaterThanOrEqual(dayDist.status_5xx);

      // 30-day totals must actually be larger (we have 30 days of data)
      const daySum =
        dayDist.status_2xx +
        dayDist.status_3xx +
        dayDist.status_4xx +
        dayDist.status_5xx;
      const fullSum =
        fullDist.status_2xx +
        fullDist.status_3xx +
        fullDist.status_4xx +
        fullDist.status_5xx;
      expect(fullSum).toBeGreaterThan(daySum);
    });

    it("returns all zeros for empty range", async () => {
      const dist = await db.getStatusDistribution({
        from: NOW + ONE_DAY,
        to: NOW + 2 * ONE_DAY,
      });
      expect(dist.status_2xx).toBe(0);
      expect(dist.status_3xx).toBe(0);
      expect(dist.status_4xx).toBe(0);
      expect(dist.status_5xx).toBe(0);
    });

    it("matches manually computed totals for a known range", async () => {
      const from = NOW - 30 * ONE_DAY;
      const to = NOW;
      const dist = await db.getStatusDistribution({ from, to });
      const indices = indicesInRange(from, to);

      // Each timestamp has 2 endpoint rows (GET /api/users, POST /api/orders)
      // Both routes use the same makeEndpointRow logic
      let expected2xx = 0;
      let expected4xx = 0;
      let expected5xx = 0;
      for (const i of indices) {
        // 2 routes with identical per-index values
        for (let r = 0; r < 2; r++) {
          const base = i + 1;
          expected2xx += base * 8;
          expected4xx += base % 5 === 0 ? base : 0;
          expected5xx += base % 10 === 0 ? 1 : 0;
        }
      }
      expect(dist.status_2xx).toBe(expected2xx);
      expect(dist.status_4xx).toBe(expected4xx);
      expect(dist.status_5xx).toBe(expected5xx);
    });
  });

  // ── Overview ─────────────────────────────────────────────────────────────

  describe("getOverview", () => {
    it("computes totals only within the time range", async () => {
      const dayOverview = await db.getOverview({
        from: NOW - ONE_DAY,
        to: NOW,
      });
      const fullOverview = await db.getOverview({
        from: NOW - 30 * ONE_DAY,
        to: NOW,
      });
      expect(fullOverview.total_requests).toBeGreaterThan(
        dayOverview.total_requests,
      );
    });

    it("computes correct rps and rpm for the range span", async () => {
      const from = NOW - ONE_DAY;
      const to = NOW;
      const overview = await db.getOverview({ from, to });

      const spanSeconds = (to - from) / 1000;
      const spanMinutes = spanSeconds / 60;
      const expectedRps = overview.total_requests / spanSeconds;
      const expectedRpm = overview.total_requests / spanMinutes;

      expect(overview.rps).toBeCloseTo(expectedRps, 5);
      expect(overview.rpm).toBeCloseTo(expectedRpm, 5);
    });

    it("returns p95 and p99 within the range", async () => {
      const overview = await db.getOverview({
        from: NOW - 7 * ONE_DAY,
        to: NOW,
      });
      expect(overview.p95_duration).toBeGreaterThan(0);
      expect(overview.p99_duration).toBeGreaterThan(0);
      expect(overview.p99_duration).toBeGreaterThanOrEqual(
        overview.p95_duration,
      );
    });

    it("returns zeros for empty range", async () => {
      const overview = await db.getOverview({
        from: NOW + ONE_DAY,
        to: NOW + 2 * ONE_DAY,
      });
      expect(overview.total_requests).toBe(0);
      expect(overview.total_errors).toBe(0);
      expect(overview.error_rate).toBe(0);
      expect(overview.avg_duration).toBe(0);
    });

    it("error_rate is correct for the range", async () => {
      const from = NOW - 30 * ONE_DAY;
      const to = NOW;
      const overview = await db.getOverview({ from, to });
      const indices = indicesInRange(from, to);

      let totalReq = 0;
      let totalErr = 0;
      for (const i of indices) {
        for (let r = 0; r < 2; r++) {
          const base = i + 1;
          totalReq += base * 10;
          totalErr += base % 5 === 0 ? base : 0;
        }
      }
      const expectedRate = (totalErr / totalReq) * 100;
      expect(overview.total_requests).toBe(totalReq);
      expect(overview.total_errors).toBe(totalErr);
      expect(overview.error_rate).toBeCloseTo(expectedRate, 5);
    });
  });

  // ── Slow requests ────────────────────────────────────────────────────────

  describe("getSlowRequests", () => {
    it("filters by threshold AND time range", async () => {
      const from = NOW - ONE_DAY;
      const to = NOW;
      // threshold = 40 → avg_duration > 40
      const slow = await db.getSlowRequests(40, { from, to });
      for (const r of slow) {
        expect(r.timestamp).toBeGreaterThanOrEqual(from);
        expect(r.timestamp).toBeLessThanOrEqual(to);
        expect(r.avg_duration).toBeGreaterThan(40);
      }
    });

    it("wider range returns more or equal slow requests", async () => {
      const daySlow = await db.getSlowRequests(40, {
        from: NOW - ONE_DAY,
        to: NOW,
      });
      const fullSlow = await db.getSlowRequests(40, {
        from: NOW - 30 * ONE_DAY,
        to: NOW,
      });
      expect(fullSlow.length).toBeGreaterThanOrEqual(daySlow.length);
    });

    it("very high threshold returns 0 rows", async () => {
      const slow = await db.getSlowRequests(999999, {
        from: NOW - 30 * ONE_DAY,
        to: NOW,
      });
      expect(slow.length).toBe(0);
    });
  });

  // ── Cross-range consistency ──────────────────────────────────────────────

  describe("cross-range consistency", () => {
    it("narrowing the range always returns fewer or equal rows", async () => {
      const ranges = [
        { from: NOW - 30 * ONE_DAY, to: NOW },
        { from: NOW - 15 * ONE_DAY, to: NOW },
        { from: NOW - 7 * ONE_DAY, to: NOW },
        { from: NOW - ONE_DAY, to: NOW },
        { from: NOW - ONE_HOUR, to: NOW },
      ];

      const counts: number[] = [];
      for (const range of ranges) {
        const rows = await db.getSystemMetrics(range);
        counts.push(rows.length);
      }

      // Each successive range should have fewer or equal rows
      for (let i = 1; i < counts.length; i++) {
        expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
      }
    });

    it("adjacent non-overlapping ranges have no duplicate timestamps", async () => {
      const mid = NOW - 15 * ONE_DAY;
      const rangeA = { from: NOW - 30 * ONE_DAY, to: mid - 1 };
      const rangeB = { from: mid, to: NOW };

      const rowsA = await db.getSystemMetrics(rangeA);
      const rowsB = await db.getSystemMetrics(rangeB);

      const tsSetA = new Set(rowsA.map((r) => r.timestamp));
      for (const r of rowsB) {
        expect(tsSetA.has(r.timestamp)).toBe(false);
      }

      // Combined should equal the full range (minus the gap of 1ms at mid-1)
      const full = await db.getSystemMetrics({
        from: NOW - 30 * ONE_DAY,
        to: NOW,
      });
      expect(rowsA.length + rowsB.length).toBe(full.length);
    });

    it("all table queries agree on row count for the same range", async () => {
      const range = { from: NOW - 7 * ONE_DAY, to: NOW };
      const system = await db.getSystemMetrics(range);
      const process = await db.getProcessMetrics(range);
      const endpoints = await db.getEndpointMetrics(range);

      // System and process have 1 row per timestamp
      expect(system.length).toBe(process.length);
      // Endpoints have 2 rows per timestamp
      expect(endpoints.length).toBe(system.length * 2);
    });
  });

  // ── Pagination ───────────────────────────────────────────────────────────

  describe("pagination", () => {
    const fullRange = { from: NOW - 30 * ONE_DAY, to: NOW };

    describe("getSystemMetricsPaginated", () => {
      it("first page returns correct slice", async () => {
        const result = await db.getSystemMetricsPaginated(fullRange, { page: 1, limit: 100 });
        expect(result.data.length).toBe(100);
        expect(result.pagination.page).toBe(1);
        expect(result.pagination.limit).toBe(100);
        expect(result.pagination.total).toBe(TOTAL_ROWS);
        expect(result.pagination.totalPages).toBe(Math.ceil(TOTAL_ROWS / 100));
        expect(result.pagination.hasNext).toBe(true);
        expect(result.pagination.hasPrev).toBe(false);
      });

      it("middle page returns correct slice", async () => {
        const result = await db.getSystemMetricsPaginated(fullRange, { page: 3, limit: 100 });
        expect(result.data.length).toBe(100);
        expect(result.pagination.page).toBe(3);
        expect(result.pagination.hasNext).toBe(true);
        expect(result.pagination.hasPrev).toBe(true);
      });

      it("last page returns remaining rows", async () => {
        const totalPages = Math.ceil(TOTAL_ROWS / 100);
        const result = await db.getSystemMetricsPaginated(fullRange, { page: totalPages, limit: 100 });
        const expectedRemaining = TOTAL_ROWS - (totalPages - 1) * 100;
        expect(result.data.length).toBe(expectedRemaining);
        expect(result.pagination.hasNext).toBe(false);
        expect(result.pagination.hasPrev).toBe(true);
      });

      it("out-of-range page returns empty data with correct total", async () => {
        const result = await db.getSystemMetricsPaginated(fullRange, { page: 999, limit: 100 });
        expect(result.data.length).toBe(0);
        expect(result.pagination.total).toBe(TOTAL_ROWS);
        expect(result.pagination.hasNext).toBe(false);
        expect(result.pagination.hasPrev).toBe(true);
      });

      it("different limit values work correctly", async () => {
        const r50 = await db.getSystemMetricsPaginated(fullRange, { page: 1, limit: 50 });
        const r200 = await db.getSystemMetricsPaginated(fullRange, { page: 1, limit: 200 });
        expect(r50.data.length).toBe(50);
        expect(r200.data.length).toBe(200);
        expect(r50.pagination.totalPages).toBe(Math.ceil(TOTAL_ROWS / 50));
        expect(r200.pagination.totalPages).toBe(Math.ceil(TOTAL_ROWS / 200));
      });
    });

    describe("getEndpointMetricsPaginated", () => {
      it("paginates endpoint rows correctly", async () => {
        const totalEndpointRows = TOTAL_ROWS * 2; // 2 routes per timestamp
        const result = await db.getEndpointMetricsPaginated(fullRange, { page: 1, limit: 100 });
        expect(result.data.length).toBe(100);
        expect(result.pagination.total).toBe(totalEndpointRows);
        expect(result.pagination.totalPages).toBe(Math.ceil(totalEndpointRows / 100));
      });

      it("total and totalPages computed correctly", async () => {
        const result = await db.getEndpointMetricsPaginated(fullRange, { page: 1, limit: 250 });
        expect(result.pagination.total).toBe(TOTAL_ROWS * 2);
        expect(result.pagination.totalPages).toBe(Math.ceil((TOTAL_ROWS * 2) / 250));
      });
    });

    describe("getErrorLogPaginated", () => {
      it("paginates error rows correctly", async () => {
        const totalErrors = Math.ceil(TOTAL_ROWS / 12); // 60
        const result = await db.getErrorLogPaginated(fullRange, { page: 1, limit: 20 });
        expect(result.data.length).toBe(20);
        expect(result.pagination.total).toBe(totalErrors);
        expect(result.pagination.totalPages).toBe(Math.ceil(totalErrors / 20));
        expect(result.pagination.hasNext).toBe(true);
        expect(result.pagination.hasPrev).toBe(false);
      });

      it("last page of errors returns remaining", async () => {
        const totalErrors = Math.ceil(TOTAL_ROWS / 12);
        const totalPages = Math.ceil(totalErrors / 20);
        const result = await db.getErrorLogPaginated(fullRange, { page: totalPages, limit: 20 });
        expect(result.data.length).toBe(totalErrors - (totalPages - 1) * 20);
        expect(result.pagination.hasNext).toBe(false);
      });
    });

    describe("getSlowRequestsPaginated", () => {
      it("paginates slow requests correctly", async () => {
        const allSlow = await db.getSlowRequests(40, fullRange);
        const result = await db.getSlowRequestsPaginated(40, fullRange, { page: 1, limit: 50 });
        expect(result.pagination.total).toBe(allSlow.length);
        expect(result.data.length).toBe(Math.min(50, allSlow.length));
        for (const r of result.data) {
          expect(r.avg_duration).toBeGreaterThan(40);
        }
      });
    });

    describe("getProcessMetricsPaginated", () => {
      it("paginates process metrics correctly", async () => {
        const result = await db.getProcessMetricsPaginated(fullRange, { page: 1, limit: 100 });
        expect(result.data.length).toBe(100);
        expect(result.pagination.total).toBe(TOTAL_ROWS);
        expect(result.pagination.hasNext).toBe(true);
        expect(result.pagination.hasPrev).toBe(false);
      });
    });
  });

  // ── deleteOlderThan respects cutoff ──────────────────────────────────────

  describe("deleteOlderThan", () => {
    let cleanupDb: SQLiteAdapter;
    let cleanupDbPath: string;

    beforeAll(async () => {
      cleanupDbPath = path.join(
        os.tmpdir(),
        `loadflux-cleanup-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
      );
      cleanupDb = new SQLiteAdapter(cleanupDbPath);
      await cleanupDb.connect();

      // Insert a smaller dataset: 10 days, 1 row per hour = 240 rows
      for (let i = 0; i < 240; i++) {
        const ts = NOW - (239 - i) * ONE_HOUR;
        cleanupDb.insertSystemMetrics(makeSystemRow(ts, i));
        cleanupDb.insertEndpointMetricsBatch([
          makeEndpointRow(ts, i, "GET", "/api/test"),
        ]);
        if (i % 24 === 0) {
          cleanupDb.insertError(makeErrorRow(ts, i));
        }
      }
    });

    afterAll(async () => {
      await cleanupDb.close();
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          fs.unlinkSync(cleanupDbPath + suffix);
        } catch {}
      }
    });

    it("deletes old data and keeps recent data", async () => {
      const cutoff = NOW - 5 * ONE_DAY;
      cleanupDb.deleteOlderThan(cutoff);

      const system = await cleanupDb.getSystemMetrics({
        from: 0,
        to: NOW + 1000,
      });
      for (const r of system) {
        expect(r.timestamp).toBeGreaterThanOrEqual(cutoff);
      }
      // Should have ~120 rows (5 days * 24 hours)
      expect(system.length).toBeGreaterThan(100);
      expect(system.length).toBeLessThan(140);

      const endpoints = await cleanupDb.getEndpointMetrics({
        from: 0,
        to: NOW + 1000,
      });
      for (const r of endpoints) {
        expect(r.timestamp).toBeGreaterThanOrEqual(cutoff);
      }

      const errors = await cleanupDb.getErrorLog({ from: 0, to: NOW + 1000 });
      for (const r of errors) {
        expect(r.timestamp).toBeGreaterThanOrEqual(cutoff);
      }
    });
  });
});
