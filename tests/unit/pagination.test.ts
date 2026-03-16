import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SQLiteAdapter } from "../../src/db/sqlite.js";
import { buildPaginatedResult } from "../../src/db/constants.js";
import type {
  SystemMetricRow,
  EndpointMetricRow,
  ErrorLogRow,
  ProcessMetricRow,
  PaginationParams,
} from "../../src/types.js";
import fs from "fs";
import path from "path";
import os from "os";

// ── buildPaginatedResult unit tests ─────────────────────────────────────────

describe("buildPaginatedResult", () => {
  it("computes totalPages as ceil(total / limit)", () => {
    const result = buildPaginatedResult([1, 2, 3], 10, { page: 1, limit: 3 });
    expect(result.pagination.totalPages).toBe(4); // ceil(10/3) = 4
  });

  it("totalPages is at least 1 even when total is 0", () => {
    const result = buildPaginatedResult([], 0, { page: 1, limit: 10 });
    expect(result.pagination.totalPages).toBe(1);
    expect(result.pagination.hasNext).toBe(false);
    expect(result.pagination.hasPrev).toBe(false);
  });

  it("hasNext is true when page < totalPages", () => {
    const result = buildPaginatedResult([1], 20, { page: 1, limit: 10 });
    expect(result.pagination.hasNext).toBe(true);
  });

  it("hasNext is false on the last page", () => {
    const result = buildPaginatedResult([1], 20, { page: 2, limit: 10 });
    expect(result.pagination.hasNext).toBe(false);
  });

  it("hasPrev is false on page 1", () => {
    const result = buildPaginatedResult([1], 20, { page: 1, limit: 10 });
    expect(result.pagination.hasPrev).toBe(false);
  });

  it("hasPrev is true on page > 1", () => {
    const result = buildPaginatedResult([1], 20, { page: 2, limit: 10 });
    expect(result.pagination.hasPrev).toBe(true);
  });

  it("preserves exact page and limit from input", () => {
    const result = buildPaginatedResult([], 50, { page: 5, limit: 7 });
    expect(result.pagination.page).toBe(5);
    expect(result.pagination.limit).toBe(7);
    expect(result.pagination.total).toBe(50);
  });

  it("single page when total equals limit", () => {
    const result = buildPaginatedResult([1, 2, 3], 3, { page: 1, limit: 3 });
    expect(result.pagination.totalPages).toBe(1);
    expect(result.pagination.hasNext).toBe(false);
    expect(result.pagination.hasPrev).toBe(false);
  });

  it("single page when total < limit", () => {
    const result = buildPaginatedResult([1, 2], 2, { page: 1, limit: 100 });
    expect(result.pagination.totalPages).toBe(1);
    expect(result.pagination.hasNext).toBe(false);
  });
});

// ── parsePagination unit tests ──────────────────────────────────────────────

describe("parsePagination", () => {
  // Re-implement parsePagination locally to test its logic independently
  // (the real function is not exported, so we mirror its logic)
  function parsePagination(query: URLSearchParams): PaginationParams | null {
    const pageStr = query.get("page");
    if (pageStr === null) return null;
    const page = Math.max(parseInt(pageStr, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(query.get("limit") ?? "200", 10) || 200, 1),
      1000,
    );
    return { page, limit };
  }

  it("returns null when page param is absent", () => {
    const q = new URLSearchParams("");
    expect(parsePagination(q)).toBeNull();
  });

  it("returns null when only limit is present (no page)", () => {
    const q = new URLSearchParams("limit=50");
    expect(parsePagination(q)).toBeNull();
  });

  it("parses page and limit correctly", () => {
    const q = new URLSearchParams("page=2&limit=50");
    expect(parsePagination(q)).toEqual({ page: 2, limit: 50 });
  });

  it("defaults limit to 200 when not provided", () => {
    const q = new URLSearchParams("page=1");
    expect(parsePagination(q)).toEqual({ page: 1, limit: 200 });
  });

  it("clamps page to minimum 1 for invalid values", () => {
    expect(parsePagination(new URLSearchParams("page=0"))!.page).toBe(1);
    expect(parsePagination(new URLSearchParams("page=-5"))!.page).toBe(1);
    expect(parsePagination(new URLSearchParams("page=abc"))!.page).toBe(1);
  });

  it("clamps limit to minimum 1", () => {
    const q = new URLSearchParams("page=1&limit=-5");
    expect(parsePagination(q)!.limit).toBe(1);
  });

  it("limit=0 is treated as NaN and falls back to default 200", () => {
    const q = new URLSearchParams("page=1&limit=0");
    // parseInt("0") = 0, || 200 kicks in → then Math.max(200, 1) = 200
    expect(parsePagination(q)!.limit).toBe(200);
  });

  it("clamps limit to maximum 1000", () => {
    const q = new URLSearchParams("page=1&limit=5000");
    expect(parsePagination(q)!.limit).toBe(1000);
  });

  it("defaults limit to 200 for non-numeric value", () => {
    const q = new URLSearchParams("page=1&limit=abc");
    expect(parsePagination(q)!.limit).toBe(200);
  });
});

// ── SQLite paginated queries (integration) ──────────────────────────────────

const DB_PATH = path.join(
  os.tmpdir(),
  `loadflux-pagination-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);

const NOW = Date.now();
const ONE_HOUR = 3_600_000;
const ONE_DAY = 86_400_000;
const TOTAL_ROWS = 150; // 150 rows for manageable math

const timestamps: number[] = [];
for (let i = 0; i < TOTAL_ROWS; i++) {
  timestamps.push(NOW - (TOTAL_ROWS - 1 - i) * ONE_HOUR);
}

function makeSystemRow(ts: number, idx: number): SystemMetricRow {
  return {
    timestamp: ts,
    cpu_percent: 10 + (idx % 80),
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

describe("SQLite paginated queries", () => {
  let db: SQLiteAdapter;
  const fullRange = { from: NOW - 30 * ONE_DAY, to: NOW };

  // Error rows are inserted every 5th index
  const ERROR_INDICES = Array.from({ length: TOTAL_ROWS }, (_, i) => i).filter(
    (i) => i % 5 === 0,
  );
  const TOTAL_ERRORS = ERROR_INDICES.length; // 30

  beforeAll(async () => {
    db = new SQLiteAdapter(DB_PATH);
    await db.connect();

    for (let i = 0; i < TOTAL_ROWS; i++) {
      const ts = timestamps[i];
      db.insertSystemMetrics(makeSystemRow(ts, i));
      db.insertProcessMetrics(makeProcessRow(ts, i));
      db.insertEndpointMetricsBatch([
        makeEndpointRow(ts, i, "GET", "/api/users"),
        makeEndpointRow(ts, i, "POST", "/api/orders"),
      ]);
      if (i % 5 === 0) {
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

  // ── Page consistency: all pages combined == full dataset ─────────────────

  describe("page consistency", () => {
    it("iterating all pages of system metrics yields all rows exactly once", async () => {
      const limit = 40;
      const totalPages = Math.ceil(TOTAL_ROWS / limit);
      const allData: SystemMetricRow[] = [];

      for (let page = 1; page <= totalPages; page++) {
        const result = await db.getSystemMetricsPaginated(fullRange, { page, limit });
        allData.push(...result.data);
      }

      expect(allData.length).toBe(TOTAL_ROWS);

      // Verify no duplicate timestamps
      const tsSet = new Set(allData.map((r) => r.timestamp));
      expect(tsSet.size).toBe(TOTAL_ROWS);
    });

    it("iterating all pages of endpoint metrics yields all rows", async () => {
      const totalEndpointRows = TOTAL_ROWS * 2;
      const limit = 60;
      const totalPages = Math.ceil(totalEndpointRows / limit);
      const allData: EndpointMetricRow[] = [];

      for (let page = 1; page <= totalPages; page++) {
        const result = await db.getEndpointMetricsPaginated(fullRange, { page, limit });
        allData.push(...result.data);
      }

      expect(allData.length).toBe(totalEndpointRows);
    });

    it("iterating all pages of error log yields all errors", async () => {
      const limit = 7;
      const totalPages = Math.ceil(TOTAL_ERRORS / limit);
      const allData: ErrorLogRow[] = [];

      for (let page = 1; page <= totalPages; page++) {
        const result = await db.getErrorLogPaginated(fullRange, { page, limit });
        allData.push(...result.data);
      }

      expect(allData.length).toBe(TOTAL_ERRORS);
    });

    it("iterating all pages of process metrics yields all rows", async () => {
      const limit = 30;
      const totalPages = Math.ceil(TOTAL_ROWS / limit);
      const allData: ProcessMetricRow[] = [];

      for (let page = 1; page <= totalPages; page++) {
        const result = await db.getProcessMetricsPaginated(fullRange, { page, limit });
        allData.push(...result.data);
      }

      expect(allData.length).toBe(TOTAL_ROWS);
    });
  });

  // ── Ordering within pages ──────────────────────────────────────────────

  describe("ordering", () => {
    it("system metrics pages are ordered by timestamp ASC", async () => {
      const result = await db.getSystemMetricsPaginated(fullRange, { page: 1, limit: 50 });
      for (let i = 1; i < result.data.length; i++) {
        expect(result.data[i].timestamp).toBeGreaterThanOrEqual(
          result.data[i - 1].timestamp,
        );
      }
    });

    it("ordering is consistent across pages (page N end < page N+1 start)", async () => {
      const p1 = await db.getSystemMetricsPaginated(fullRange, { page: 1, limit: 50 });
      const p2 = await db.getSystemMetricsPaginated(fullRange, { page: 2, limit: 50 });
      const lastOfP1 = p1.data[p1.data.length - 1].timestamp;
      const firstOfP2 = p2.data[0].timestamp;
      expect(firstOfP2).toBeGreaterThanOrEqual(lastOfP1);
    });

    it("error log pages are ordered by timestamp DESC", async () => {
      const result = await db.getErrorLogPaginated(fullRange, { page: 1, limit: 20 });
      for (let i = 1; i < result.data.length; i++) {
        expect(result.data[i].timestamp).toBeLessThanOrEqual(
          result.data[i - 1].timestamp,
        );
      }
    });

    it("error log ordering is consistent across pages (page N end > page N+1 start)", async () => {
      const p1 = await db.getErrorLogPaginated(fullRange, { page: 1, limit: 10 });
      const p2 = await db.getErrorLogPaginated(fullRange, { page: 2, limit: 10 });
      const lastOfP1 = p1.data[p1.data.length - 1].timestamp;
      const firstOfP2 = p2.data[0].timestamp;
      expect(lastOfP1).toBeGreaterThanOrEqual(firstOfP2);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("limit=1 yields one row per page and correct totalPages", async () => {
      const result = await db.getSystemMetricsPaginated(fullRange, { page: 1, limit: 1 });
      expect(result.data.length).toBe(1);
      expect(result.pagination.totalPages).toBe(TOTAL_ROWS);
      expect(result.pagination.hasNext).toBe(true);
    });

    it("limit larger than total rows returns all rows on page 1", async () => {
      const result = await db.getSystemMetricsPaginated(fullRange, {
        page: 1,
        limit: TOTAL_ROWS + 100,
      });
      expect(result.data.length).toBe(TOTAL_ROWS);
      expect(result.pagination.totalPages).toBe(1);
      expect(result.pagination.hasNext).toBe(false);
      expect(result.pagination.hasPrev).toBe(false);
    });

    it("limit exactly equals total rows: single page", async () => {
      const result = await db.getSystemMetricsPaginated(fullRange, {
        page: 1,
        limit: TOTAL_ROWS,
      });
      expect(result.data.length).toBe(TOTAL_ROWS);
      expect(result.pagination.totalPages).toBe(1);
      expect(result.pagination.hasNext).toBe(false);
    });

    it("page far beyond total returns empty data but correct total", async () => {
      const result = await db.getSystemMetricsPaginated(fullRange, {
        page: 1000,
        limit: 50,
      });
      expect(result.data.length).toBe(0);
      expect(result.pagination.total).toBe(TOTAL_ROWS);
      expect(result.pagination.totalPages).toBe(Math.ceil(TOTAL_ROWS / 50));
      expect(result.pagination.hasNext).toBe(false);
      expect(result.pagination.hasPrev).toBe(true);
    });

    it("page=2 with limit > total returns empty (only 1 page exists)", async () => {
      const result = await db.getSystemMetricsPaginated(fullRange, {
        page: 2,
        limit: TOTAL_ROWS + 50,
      });
      expect(result.data.length).toBe(0);
      expect(result.pagination.totalPages).toBe(1);
      expect(result.pagination.hasPrev).toBe(true);
      expect(result.pagination.hasNext).toBe(false);
    });
  });

  // ── Pagination + time range interaction ──────────────────────────────────

  describe("pagination with time range filtering", () => {
    it("pagination total reflects the filtered row count, not all rows", async () => {
      // Use a narrow range that captures only ~24 rows (1 day)
      const narrowRange = { from: NOW - ONE_DAY, to: NOW };
      const narrowCount = timestamps.filter(
        (t) => t >= narrowRange.from && t <= narrowRange.to,
      ).length;

      const result = await db.getSystemMetricsPaginated(narrowRange, {
        page: 1,
        limit: 10,
      });

      expect(result.pagination.total).toBe(narrowCount);
      expect(result.pagination.totalPages).toBe(Math.ceil(narrowCount / 10));
      expect(result.data.length).toBe(Math.min(10, narrowCount));

      // All returned rows must be within the range
      for (const row of result.data) {
        expect(row.timestamp).toBeGreaterThanOrEqual(narrowRange.from);
        expect(row.timestamp).toBeLessThanOrEqual(narrowRange.to);
      }
    });

    it("empty time range returns empty data with total=0 and totalPages=1", async () => {
      const emptyRange = { from: NOW + ONE_DAY, to: NOW + 2 * ONE_DAY };
      const result = await db.getSystemMetricsPaginated(emptyRange, {
        page: 1,
        limit: 10,
      });
      expect(result.data.length).toBe(0);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(1);
      expect(result.pagination.hasNext).toBe(false);
      expect(result.pagination.hasPrev).toBe(false);
    });

    it("narrowing time range reduces pagination total", async () => {
      const wide = await db.getSystemMetricsPaginated(fullRange, { page: 1, limit: 10 });
      const narrow = await db.getSystemMetricsPaginated(
        { from: NOW - 2 * ONE_DAY, to: NOW },
        { page: 1, limit: 10 },
      );
      expect(narrow.pagination.total).toBeLessThan(wide.pagination.total);
    });

    it("endpoint pagination with narrow range counts only matching rows", async () => {
      const narrowRange = { from: NOW - ONE_DAY, to: NOW };
      const narrowTimestamps = timestamps.filter(
        (t) => t >= narrowRange.from && t <= narrowRange.to,
      ).length;
      const expectedEndpointRows = narrowTimestamps * 2;

      const result = await db.getEndpointMetricsPaginated(narrowRange, {
        page: 1,
        limit: 100,
      });
      expect(result.pagination.total).toBe(expectedEndpointRows);
    });

    it("error pagination with narrow range counts only matching errors", async () => {
      const narrowRange = { from: NOW - ONE_DAY, to: NOW };
      const errorsInRange = ERROR_INDICES.filter((i) => {
        const ts = timestamps[i];
        return ts >= narrowRange.from && ts <= narrowRange.to;
      }).length;

      const result = await db.getErrorLogPaginated(narrowRange, {
        page: 1,
        limit: 100,
      });
      expect(result.pagination.total).toBe(errorsInRange);
    });
  });

  // ── Slow requests pagination ─────────────────────────────────────────────

  describe("slow requests pagination", () => {
    it("total matches non-paginated slow request count", async () => {
      const threshold = 40;
      const allSlow = await db.getSlowRequests(threshold, fullRange);
      const paginated = await db.getSlowRequestsPaginated(threshold, fullRange, {
        page: 1,
        limit: 10,
      });
      expect(paginated.pagination.total).toBe(allSlow.length);
    });

    it("all paginated slow requests exceed the threshold", async () => {
      const threshold = 40;
      const result = await db.getSlowRequestsPaginated(threshold, fullRange, {
        page: 1,
        limit: 50,
      });
      for (const row of result.data) {
        expect(row.avg_duration).toBeGreaterThan(threshold);
      }
    });

    it("slow requests are ordered by avg_duration DESC", async () => {
      const result = await db.getSlowRequestsPaginated(30, fullRange, {
        page: 1,
        limit: 50,
      });
      for (let i = 1; i < result.data.length; i++) {
        expect(result.data[i].avg_duration).toBeLessThanOrEqual(
          result.data[i - 1].avg_duration,
        );
      }
    });

    it("very high threshold returns total=0 and empty data", async () => {
      const result = await db.getSlowRequestsPaginated(999999, fullRange, {
        page: 1,
        limit: 10,
      });
      expect(result.data.length).toBe(0);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(1);
    });

    it("iterating all slow request pages yields all matching rows", async () => {
      const threshold = 40;
      const allSlow = await db.getSlowRequests(threshold, fullRange);
      const limit = 15;
      const totalPages = Math.ceil(allSlow.length / limit);
      const collected: EndpointMetricRow[] = [];

      for (let page = 1; page <= totalPages; page++) {
        const result = await db.getSlowRequestsPaginated(threshold, fullRange, {
          page,
          limit,
        });
        collected.push(...result.data);
      }

      expect(collected.length).toBe(allSlow.length);
    });
  });

  // ── Metadata consistency ──────────────────────────────────────────────────

  describe("metadata consistency across pages", () => {
    it("total and totalPages remain constant across all pages", async () => {
      const limit = 30;
      const totalPages = Math.ceil(TOTAL_ROWS / limit);

      for (let page = 1; page <= totalPages; page++) {
        const result = await db.getSystemMetricsPaginated(fullRange, { page, limit });
        expect(result.pagination.total).toBe(TOTAL_ROWS);
        expect(result.pagination.totalPages).toBe(totalPages);
        expect(result.pagination.page).toBe(page);
        expect(result.pagination.limit).toBe(limit);
      }
    });

    it("hasNext/hasPrev flags are correct for every page", async () => {
      const limit = 50;
      const totalPages = Math.ceil(TOTAL_ROWS / limit);

      for (let page = 1; page <= totalPages; page++) {
        const result = await db.getSystemMetricsPaginated(fullRange, { page, limit });
        expect(result.pagination.hasPrev).toBe(page > 1);
        expect(result.pagination.hasNext).toBe(page < totalPages);
      }
    });

    it("last page data length equals total - (totalPages-1) * limit", async () => {
      const limit = 40;
      const totalPages = Math.ceil(TOTAL_ROWS / limit);
      const result = await db.getSystemMetricsPaginated(fullRange, {
        page: totalPages,
        limit,
      });
      const expectedLastPageSize = TOTAL_ROWS - (totalPages - 1) * limit;
      expect(result.data.length).toBe(expectedLastPageSize);
    });
  });
});
