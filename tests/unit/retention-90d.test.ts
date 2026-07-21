/**
 * Verifies 90-day retention deletion for SQLite and local MongoDB.
 * Inserts artificial rows older and newer than 90 days, runs runRetentionCleanup.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "path";
import os from "os";
import fs from "fs";
import { MongoClient } from "mongodb";
import { SQLiteAdapter } from "../../src/db/sqlite.js";
import { runRetentionCleanup } from "../../src/core/cron.js";
import { resolveConfig } from "../../src/config.js";
import {
  makeSystemRow,
  makeProcessRow,
  makeEndpointRow,
  makeErrorRow,
} from "../helpers/fixtures.js";

const ONE_DAY = 86_400_000;
const NOW = Date.now();

const TS_100D = NOW - 100 * ONE_DAY; // delete
const TS_95D = NOW - 95 * ONE_DAY; // delete
const TS_80D = NOW - 80 * ONE_DAY; // keep
const TS_1D = NOW - 1 * ONE_DAY; // keep

const MONGO_URI =
  process.env.LOADFLUX_TEST_MONGODB_URI?.trim() || "mongodb://127.0.0.1:27017";

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function seedAll(
  db: {
    insertSystemMetrics: (r: ReturnType<typeof makeSystemRow>) => void;
    insertProcessMetrics: (r: ReturnType<typeof makeProcessRow>) => void;
    insertEndpointMetricsBatch: (r: ReturnType<typeof makeEndpointRow>[]) => void;
    insertError: (r: ReturnType<typeof makeErrorRow>) => void;
  },
  timestamps: number[],
) {
  timestamps.forEach((ts, i) => {
    db.insertSystemMetrics(makeSystemRow(ts, i));
    db.insertProcessMetrics(makeProcessRow(ts, i));
    db.insertEndpointMetricsBatch([
      makeEndpointRow(ts, i, "GET", `/retention/${i}`),
    ]);
    db.insertError(makeErrorRow(ts, i));
  });
}

describe("90-day retention deletion (SQLite)", () => {
  const dbPath = path.join(
    os.tmpdir(),
    `loadflux-ret90-sqlite-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
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
      } catch {
        /* ignore */
      }
    }
  });

  it("deletes data older than 90 days and keeps newer data (all tables)", async () => {
    await seedAll(db, [TS_100D, TS_95D, TS_80D, TS_1D]);

    const beforeSystem = await db.getSystemMetrics({ from: 0, to: NOW + 1000 });
    expect(beforeSystem).toHaveLength(4);

    const config = resolveConfig({ retention: { days: 90 } });
    expect(config.retention.days).toBe(90);

    await runRetentionCleanup(db, config);

    const cutoff = NOW - 90 * ONE_DAY;
    const system = await db.getSystemMetrics({ from: 0, to: NOW + 1000 });
    const process = await db.getProcessMetrics({ from: 0, to: NOW + 1000 });
    const endpoints = await db.getEndpointMetrics({ from: 0, to: NOW + 1000 });
    const errors = await db.getErrorLog({ from: 0, to: NOW + 1000 });

    for (const rows of [system, process, endpoints, errors]) {
      expect(rows.some((r) => r.timestamp === TS_100D)).toBe(false);
      expect(rows.some((r) => r.timestamp === TS_95D)).toBe(false);
      expect(rows.some((r) => r.timestamp === TS_80D)).toBe(true);
      expect(rows.some((r) => r.timestamp === TS_1D)).toBe(true);
      for (const r of rows) {
        expect(r.timestamp).toBeGreaterThanOrEqual(cutoff);
      }
    }

    expect(system).toHaveLength(2);
    expect(process).toHaveLength(2);
    expect(endpoints).toHaveLength(2);
    expect(errors).toHaveLength(2);
  });
});

describe("90-day retention deletion (MongoDB local)", () => {
  let db: import("../../src/db/mongodb.js").MongoDBAdapter;
  let dbName: string;
  let mongoAvailable = false;

  beforeAll(async () => {
    const probe = new MongoClient(MONGO_URI, {
      serverSelectionTimeoutMS: 3000,
    });
    try {
      await probe.connect();
      await probe.db("admin").command({ ping: 1 });
      mongoAvailable = true;
    } catch {
      mongoAvailable = false;
    } finally {
      await probe.close().catch(() => {});
    }

    if (!mongoAvailable) return;

    const { MongoDBAdapter } = await import("../../src/db/mongodb.js");
    dbName = `lf_ret90_${Date.now()}`;
    const base = MONGO_URI.replace(/\/$/, "");
    db = new MongoDBAdapter(`${base}/${dbName}`);
    await db.connect();
  });

  afterAll(async () => {
    if (!mongoAvailable) return;
    try {
      const client = new MongoClient(MONGO_URI);
      await client.connect();
      await client.db(dbName).dropDatabase();
      await client.close();
    } catch {
      /* ignore */
    }
    await db.close();
  });

  it("deletes data older than 90 days and keeps newer data (all collections)", async ({
    skip,
  }) => {
    if (!mongoAvailable) {
      skip("MongoDB not reachable on " + MONGO_URI);
    }

    await seedAll(db, [TS_100D, TS_95D, TS_80D, TS_1D]);
    // inserts are fire-and-forget
    await sleep(1000);

    const beforeSystem = await db.getSystemMetrics({ from: 0, to: NOW + 1000 });
    expect(beforeSystem.length).toBeGreaterThanOrEqual(4);

    const config = resolveConfig({ retention: { days: 90 } });
    expect(config.retention.days).toBe(90);

    await runRetentionCleanup(db, config);
    // deleteOlderThan is fire-and-forget
    await sleep(1500);

    const cutoff = NOW - 90 * ONE_DAY;
    const system = await db.getSystemMetrics({ from: 0, to: NOW + 1000 });
    const process = await db.getProcessMetrics({ from: 0, to: NOW + 1000 });
    const endpoints = await db.getEndpointMetrics({ from: 0, to: NOW + 1000 });
    const errors = await db.getErrorLog({ from: 0, to: NOW + 1000 });

    for (const rows of [system, process, endpoints, errors]) {
      expect(rows.some((r) => r.timestamp === TS_100D)).toBe(false);
      expect(rows.some((r) => r.timestamp === TS_95D)).toBe(false);
      expect(rows.some((r) => r.timestamp === TS_80D)).toBe(true);
      expect(rows.some((r) => r.timestamp === TS_1D)).toBe(true);
      for (const r of rows) {
        expect(r.timestamp).toBeGreaterThanOrEqual(cutoff);
      }
    }

    expect(system).toHaveLength(2);
    expect(process).toHaveLength(2);
    expect(endpoints).toHaveLength(2);
    expect(errors).toHaveLength(2);
  });
});
