/**
 * MongoDB cluster + lifetime counter behavior (requires local MongoDB).
 *
 * Set `LOADFLUX_TEST_MONGODB_URI` to a base URI without a database path, e.g.
 * `mongodb://127.0.0.1:27017`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoClient } from "mongodb";
import {
  LIFETIME_TOTAL_REQUESTS_KEY,
  LIFETIME_TOTAL_ERRORS_KEY,
  LIFETIME_TOTALS_SEEDED_KEY,
  TABLE_ENDPOINT_METRICS,
  TABLE_SETTINGS,
} from "../../src/db/constants.js";
import { makeEndpointRow } from "../helpers/fixtures.js";

const MONGO_URI =
  process.env.LOADFLUX_TEST_MONGODB_URI?.trim() || "mongodb://127.0.0.1:27017";

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function mongoReachable(): Promise<boolean> {
  const probe = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 3000 });
  try {
    await probe.connect();
    await probe.db("admin").command({ ping: 1 });
    return true;
  } catch {
    return false;
  } finally {
    await probe.close().catch(() => {});
  }
}

describe("MongoDB lifetime and cluster metrics", () => {
  let mongoAvailable = false;
  let dbName: string;
  let db: import("../../src/db/mongodb.js").MongoDBAdapter;

  beforeAll(async () => {
    mongoAvailable = await mongoReachable();
    if (!mongoAvailable) return;

    const { MongoDBAdapter } = await import("../../src/db/mongodb.js");
    dbName = `lf_mongo_cluster_${Date.now()}`;
    const base = MONGO_URI.replace(/\/$/, "");
    db = new MongoDBAdapter(`${base}/${dbName}`);
  });

  afterAll(async () => {
    if (!mongoAvailable) return;
    try {
      await db.close();
    } catch {
      /* ignore */
    }
    const client = new MongoClient(MONGO_URI);
    try {
      await client.connect();
      await client.db(dbName).dropDatabase();
    } finally {
      await client.close().catch(() => {});
    }
  });

  it("seeds lifetime totals from endpoint_metrics on connect", async ({
    skip,
  }) => {
    if (!mongoAvailable) skip("MongoDB not reachable");

    const base = MONGO_URI.replace(/\/$/, "");
    const uri = `${base}/${dbName}_seed`;
    const client = new MongoClient(uri);
    await client.connect();
    const mdb = client.db(`${dbName}_seed`);
    const now = Date.now();
    await mdb.collection(TABLE_ENDPOINT_METRICS).insertMany([
      {
        ...makeEndpointRow(now, 9, "GET", "/a"),
        instance_id: "replica-a",
        request_count: 40,
        error_count: 2,
      },
      {
        ...makeEndpointRow(now + 1, 4, "GET", "/b"),
        instance_id: "replica-b",
        request_count: 60,
        error_count: 3,
      },
    ]);
    await client.close();

    const { MongoDBAdapter } = await import("../../src/db/mongodb.js");
    const adapter = new MongoDBAdapter(uri);
    await adapter.connect();

    const totals = await adapter.getLifetimeTotals();
    expect(totals.total_requests).toBe(100);
    expect(totals.total_errors).toBe(5);

    await adapter.close();
    const drop = new MongoClient(uri);
    await drop.connect();
    await drop.db(`${dbName}_seed`).dropDatabase();
    await drop.close();
  });

  it("applyLifetimeBaseline wins over an early increment (seed race)", async ({
    skip,
  }) => {
    if (!mongoAvailable) skip("MongoDB not reachable");

    const base = MONGO_URI.replace(/\/$/, "");
    const uri = `${base}/${dbName}_race`;
    const client = new MongoClient(uri);
    await client.connect();
    const mdb = client.db(`${dbName}_race`);
    const now = Date.now();
    await mdb.collection(TABLE_ENDPOINT_METRICS).insertOne({
      ...makeEndpointRow(now, 0, "GET", "/hist"),
      instance_id: "replica-a",
      request_count: 1000,
      error_count: 10,
    });
    // Simulate another replica flushing before seed completes
    await mdb.collection(TABLE_SETTINGS).insertOne({
      key: LIFETIME_TOTAL_REQUESTS_KEY,
      value: "5",
      numeric_value: 5,
    });
    await client.close();

    const { MongoDBAdapter } = await import("../../src/db/mongodb.js");
    const adapter = new MongoDBAdapter(uri);
    await adapter.connect();

    const totals = await adapter.getLifetimeTotals();
    expect(totals.total_requests).toBeGreaterThanOrEqual(1000);

    const verify = new MongoClient(uri);
    await verify.connect();
    const seeded = await verify
      .db(`${dbName}_race`)
      .collection(TABLE_SETTINGS)
      .findOne({ key: LIFETIME_TOTALS_SEEDED_KEY });
    expect(seeded).toBeTruthy();
    await verify.close();

    await adapter.close();
    const drop = new MongoClient(uri);
    await drop.connect();
    await drop.db(`${dbName}_race`).dropDatabase();
    await drop.close();
  });

  it("getLiveOverview sums recent traffic across instances", async ({
    skip,
  }) => {
    if (!mongoAvailable) skip("MongoDB not reachable");

    await db.connect();
    const now = Date.now();
    db.insertEndpointMetricsBatch([
      {
        ...makeEndpointRow(now, 0, "GET", "/x"),
        instance_id: "i-a",
        request_count: 10,
        error_count: 0,
        timestamp: now,
      },
      {
        ...makeEndpointRow(now, 0, "GET", "/y"),
        instance_id: "i-b",
        request_count: 20,
        error_count: 0,
        timestamp: now,
      },
    ]);
    await sleep(600);

    const live = await db.getLiveOverview(now, 5000);
    expect(live.rpm).toBeGreaterThanOrEqual(30);
    expect(live.total_requests).toBeGreaterThanOrEqual(30);

    await db.close();
    db = new (await import("../../src/db/mongodb.js")).MongoDBAdapter(
      `${MONGO_URI.replace(/\/$/, "")}/${dbName}`,
    );
  });

  it("getClusterSystemLive aggregates latest sample per instance", async ({
    skip,
  }) => {
    if (!mongoAvailable) skip("MongoDB not reachable");

    await db.connect();
    const now = Date.now();
    db.insertSystemMetrics({
      timestamp: now,
      instance_id: "sys-a",
      cpu_percent: 10,
      mem_total: 1_000,
      mem_used: 500,
      mem_percent: 50,
      disk_total: null,
      disk_used: null,
      disk_percent: null,
      net_rx_bytes: 0,
      net_tx_bytes: 0,
    });
    db.insertSystemMetrics({
      timestamp: now,
      instance_id: "sys-b",
      cpu_percent: 30,
      mem_total: 1_000,
      mem_used: 500,
      mem_percent: 50,
      disk_total: null,
      disk_used: null,
      disk_percent: null,
      net_rx_bytes: 0,
      net_tx_bytes: 0,
    });
    await sleep(400);

    const row = await db.getClusterSystemLive(60_000);
    expect(row).not.toBeNull();
    expect(row!.cpu_percent).toBeGreaterThanOrEqual(10);

    await db.close();
    const { MongoDBAdapter } = await import("../../src/db/mongodb.js");
    db = new MongoDBAdapter(`${MONGO_URI.replace(/\/$/, "")}/${dbName}`);
  });

  it("incrementLifetimeTotals updates counters after seed", async ({
    skip,
  }) => {
    if (!mongoAvailable) skip("MongoDB not reachable");

    await db.connect();
    db.incrementLifetimeTotals(7, 1);
    await sleep(500);

    let totals = await db.getLifetimeTotals();
    expect(totals.total_requests).toBeGreaterThanOrEqual(7);
    expect(totals.total_errors).toBeGreaterThanOrEqual(1);

    db.incrementLifetimeTotals(3, 0);
    await sleep(500);
    totals = await db.getLifetimeTotals();
    expect(totals.total_requests).toBeGreaterThanOrEqual(10);

    await db.close();
    const { MongoDBAdapter } = await import("../../src/db/mongodb.js");
    db = new MongoDBAdapter(`${MONGO_URI.replace(/\/$/, "")}/${dbName}`);
  });
});
