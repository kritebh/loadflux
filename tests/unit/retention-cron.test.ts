import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "path";
import os from "os";
import fs from "fs";
import { SQLiteAdapter } from "../../src/db/sqlite.js";
import { runRetentionCleanup } from "../../src/core/cron.js";
import { resolveConfig } from "../../src/config.js";
import type { SystemMetricRow } from "../../src/types.js";

const ONE_DAY = 86_400_000;

function makeSystemRow(ts: number): SystemMetricRow {
  return {
    timestamp: ts,
    cpu_percent: 10,
    mem_total: 8_000_000_000,
    mem_used: 2_000_000_000,
    mem_percent: 25,
    disk_total: 100_000_000_000,
    disk_used: 40_000_000_000,
    disk_percent: 40,
    net_rx_bytes: 0,
    net_tx_bytes: 0,
  };
}

describe("runRetentionCleanup (cron logic)", () => {
  const dbPath = path.join(
    os.tmpdir(),
    `loadflux-retention-cron-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  let db: SQLiteAdapter;

  beforeAll(async () => {
    db = new SQLiteAdapter(dbPath);
    await db.connect();
  });

  afterAll(async () => {
    await db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(dbPath + suffix);
      } catch {}
    }
  });

  it("removes rows older than retention_days from settings (SQLite)", async () => {
    const now = Date.now();
    const oldTs = now - 3 * ONE_DAY;
    const recentTs = now - ONE_DAY / 2;

    db.insertSystemMetrics(makeSystemRow(oldTs));
    db.insertSystemMetrics(makeSystemRow(recentTs));
    db.setSetting("retention_days", "1");

    const config = resolveConfig({ retention: { days: 90 } });
    await runRetentionCleanup(db, config);

    const rows = await db.getSystemMetrics({ from: 0, to: now + 1000 });
    expect(rows.some((r) => r.timestamp === oldTs)).toBe(false);
    expect(rows.some((r) => r.timestamp === recentTs)).toBe(true);
  });
});

/**
 * Set `LOADFLUX_TEST_MONGODB_URI` to a base URI without a database path, e.g.
 * `mongodb://127.0.0.1:27017`, so the test can use a unique database name.
 */
const MONGO_URI = process.env.LOADFLUX_TEST_MONGODB_URI?.trim();

describe.skipIf(!MONGO_URI)("runRetentionCleanup (MongoDB)", () => {
  let db: import("../../src/db/mongodb.js").MongoDBAdapter;

  beforeAll(async () => {
    const { MongoDBAdapter } = await import("../../src/db/mongodb.js");
    const base = MONGO_URI!.replace(/\/*$/, "");
    const uri = `${base}/lf_ret_${Date.now()}`;
    db = new MongoDBAdapter(uri);
    await db.connect();
  });

  afterAll(async () => {
    await db.close();
  });

  it("removes old system metrics", async () => {
    const now = Date.now();
    const oldTs = now - 5 * ONE_DAY;
    const recentTs = now - ONE_DAY / 2;

    db.insertSystemMetrics(makeSystemRow(oldTs));
    db.insertSystemMetrics(makeSystemRow(recentTs));
    db.setSetting("retention_days", "2");

    await new Promise((r) => setTimeout(r, 400));

    const config = resolveConfig({ retention: { days: 90 } });
    await runRetentionCleanup(db, config);

    await new Promise((r) => setTimeout(r, 500));

    const rows = await db.getSystemMetrics({ from: 0, to: now + 1000 });
    expect(rows.some((r) => r.timestamp === oldTs)).toBe(false);
    expect(rows.some((r) => r.timestamp === recentTs)).toBe(true);
  });
});
