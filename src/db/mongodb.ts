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
} from "../types.js";
import {
  TABLE_SYSTEM_METRICS,
  TABLE_PROCESS_METRICS,
  TABLE_ENDPOINT_METRICS,
  TABLE_ERROR_LOG,
  TABLE_SETTINGS,
  TABLE_AUTH,
  EMPTY_STATUS_DISTRIBUTION,
  EMPTY_OVERVIEW_BASE,
  withRpsRpm,
} from "./constants.js";
import { fireAndForget } from "./utils.js";

type MongoClient = import("mongodb").MongoClient;
type Db = import("mongodb").Db;
type Collection = import("mongodb").Collection;

export class MongoDBAdapter implements DatabaseAdapter {
  private client!: MongoClient;
  private db!: Db;
  private systemCol!: Collection;
  private processCol!: Collection;
  private endpointCol!: Collection;
  private errorCol!: Collection;
  private settingsCol!: Collection;
  private authCol!: Collection;

  constructor(private connectionString: string) {}

  async connect(): Promise<void> {
    let mongodb: typeof import("mongodb");
    try {
      mongodb = await import("mongodb");
    } catch {
      throw new Error(
        'LoadFlux: MongoDB adapter requires the "mongodb" package. Install it with: npm install mongodb',
      );
    }

    this.client = new mongodb.MongoClient(this.connectionString);
    await this.client.connect();
    // Extract DB name from connection string, default to "loadflux"
    const dbName = this.parseDatabaseName() || "loadflux";
    this.db = this.client.db(dbName);

    this.systemCol = this.db.collection(TABLE_SYSTEM_METRICS);
    this.processCol = this.db.collection(TABLE_PROCESS_METRICS);
    this.endpointCol = this.db.collection(TABLE_ENDPOINT_METRICS);
    this.errorCol = this.db.collection(TABLE_ERROR_LOG);
    this.settingsCol = this.db.collection(TABLE_SETTINGS);
    this.authCol = this.db.collection(TABLE_AUTH);

    await this.ensureIndexes();
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  private async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.systemCol.createIndex({ timestamp: 1 }),
      this.processCol.createIndex({ timestamp: 1 }),
      this.endpointCol.createIndex({ timestamp: 1 }),
      this.endpointCol.createIndex({ method: 1, path: 1 }),
      this.errorCol.createIndex({ timestamp: 1 }),
      this.errorCol.createIndex({ method: 1, path: 1 }),
      this.settingsCol.createIndex({ key: 1 }, { unique: true }),
      this.authCol.createIndex({ username: 1 }, { unique: true }),
    ]);
  }

  private parseDatabaseName(): string | null {
    try {
      const url = new URL(this.connectionString);
      const dbName = url.pathname.replace(/^\//, "");
      return dbName || null;
    } catch {
      return null;
    }
  }

  // ─── Inserts (fire-and-forget) ──────────────────────────────────────────

  insertSystemMetrics(m: SystemMetricRow): void {
    fireAndForget(
      this.systemCol.insertOne({ ...m }),
      "MongoDB insertSystemMetrics",
    );
  }

  insertProcessMetrics(m: ProcessMetricRow): void {
    fireAndForget(
      this.processCol.insertOne({ ...m }),
      "MongoDB insertProcessMetrics",
    );
  }

  insertEndpointMetricsBatch(rows: EndpointMetricRow[]): void {
    if (rows.length === 0) return;
    fireAndForget(
      this.endpointCol.insertMany(rows),
      "MongoDB insertEndpointMetricsBatch",
    );
  }

  insertError(e: ErrorLogRow): void {
    fireAndForget(
      this.errorCol.insertOne({ ...e }),
      "MongoDB insertError",
    );
  }

  // ─── Queries ────────────────────────────────────────────────────────────

  async getSystemMetrics(range: TimeRange): Promise<SystemMetricRow[]> {
    const docs = await this.systemCol
      .find({ timestamp: { $gte: range.from, $lte: range.to } })
      .sort({ timestamp: 1 })
      .toArray();
    return docs as unknown as SystemMetricRow[];
  }

  async getProcessMetrics(range: TimeRange): Promise<ProcessMetricRow[]> {
    const docs = await this.processCol
      .find({ timestamp: { $gte: range.from, $lte: range.to } })
      .sort({ timestamp: 1 })
      .toArray();
    return docs as unknown as ProcessMetricRow[];
  }

  async getEndpointMetrics(range: TimeRange): Promise<EndpointMetricRow[]> {
    const docs = await this.endpointCol
      .find({ timestamp: { $gte: range.from, $lte: range.to } })
      .sort({ timestamp: 1 })
      .toArray();
    return docs as unknown as EndpointMetricRow[];
  }

  async getTopEndpoints(
    metric: TopEndpointMetric,
    limit: number,
    range: TimeRange,
  ): Promise<TopEndpointRow[]> {
    if (metric === "avg_duration" || metric === "error_rate") {
      const groupFields: Record<string, any> =
        metric === "avg_duration"
          ? {
              total_duration_sum: { $sum: "$total_duration" },
              request_count_sum: { $sum: "$request_count" },
            }
          : {
              error_count_sum: { $sum: "$error_count" },
              request_count_sum: { $sum: "$request_count" },
            };

      const condExpr =
        metric === "avg_duration"
          ? {
              $cond: [
                { $gt: ["$request_count_sum", 0] },
                {
                  $divide: ["$total_duration_sum", "$request_count_sum"],
                },
                0,
              ],
            }
          : {
              $cond: [
                { $gt: ["$request_count_sum", 0] },
                {
                  $divide: ["$error_count_sum", "$request_count_sum"],
                },
                0,
              ],
            };

      return this.endpointCol
        .aggregate<TopEndpointRow>([
          { $match: { timestamp: { $gte: range.from, $lte: range.to } } },
          {
            $group: {
              _id: { method: "$method", path: "$path" },
              ...groupFields,
            },
          },
          { $addFields: { value: condExpr } },
          { $sort: { value: -1 } },
          { $limit: limit },
          {
            $project: {
              _id: 0,
              method: "$_id.method",
              path: "$_id.path",
              value: 1,
            },
          },
        ])
        .toArray();
    }

    // Simple accumulator cases
    let valueExpr: Record<string, any>;
    switch (metric) {
      case "request_count":
        valueExpr = { $sum: "$request_count" };
        break;
      case "p95_duration":
        valueExpr = { $avg: "$p95_duration" };
        break;
      case "total_res_bytes":
        valueExpr = { $sum: "$total_res_bytes" };
        break;
    }

    return this.endpointCol
      .aggregate<TopEndpointRow>([
        { $match: { timestamp: { $gte: range.from, $lte: range.to } } },
        {
          $group: {
            _id: { method: "$method", path: "$path" },
            value: valueExpr,
          },
        },
        { $sort: { value: -1 } },
        { $limit: limit },
        {
          $project: {
            _id: 0,
            method: "$_id.method",
            path: "$_id.path",
            value: 1,
          },
        },
      ])
      .toArray();
  }

  async getSlowRequests(
    thresholdMs: number,
    range: TimeRange,
  ): Promise<EndpointMetricRow[]> {
    const docs = await this.endpointCol
      .find({
        timestamp: { $gte: range.from, $lte: range.to },
        avg_duration: { $gt: thresholdMs },
      })
      .sort({ avg_duration: -1 })
      .toArray();
    return docs as unknown as EndpointMetricRow[];
  }

  async getErrorLog(range: TimeRange): Promise<ErrorLogRow[]> {
    const docs = await this.errorCol
      .find({ timestamp: { $gte: range.from, $lte: range.to } })
      .sort({ timestamp: -1 })
      .toArray();
    return docs as unknown as ErrorLogRow[];
  }

  async getStatusDistribution(range: TimeRange): Promise<StatusDistribution> {
    const result = await this.endpointCol
      .aggregate<StatusDistribution>([
        { $match: { timestamp: { $gte: range.from, $lte: range.to } } },
        {
          $group: {
            _id: null,
            status_2xx: { $sum: "$status_2xx" },
            status_3xx: { $sum: "$status_3xx" },
            status_4xx: { $sum: "$status_4xx" },
            status_5xx: { $sum: "$status_5xx" },
          },
        },
        { $project: { _id: 0 } },
      ])
      .toArray();
    return result[0] ?? EMPTY_STATUS_DISTRIBUTION;
  }

  async getOverview(range: TimeRange): Promise<OverviewMetrics> {
    const result = await this.endpointCol
      .aggregate<{
        total_requests: number;
        total_errors: number;
        total_duration: number;
        p95_duration: number;
        p99_duration: number;
      }>([
        { $match: { timestamp: { $gte: range.from, $lte: range.to } } },
        {
          $group: {
            _id: null,
            total_requests: { $sum: "$request_count" },
            total_errors: { $sum: "$error_count" },
            total_duration: { $sum: "$total_duration" },
            p95_duration: { $max: "$p95_duration" },
            p99_duration: { $max: "$p99_duration" },
          },
        },
      ])
      .toArray();

    const row =
      result[0] ?? {
        total_requests: 0,
        total_errors: 0,
        total_duration: 0,
        p95_duration: 0,
        p99_duration: 0,
      };

    const base = {
      ...EMPTY_OVERVIEW_BASE,
      total_requests: row.total_requests,
      total_errors: row.total_errors,
      error_rate:
        row.total_requests > 0
          ? (row.total_errors / row.total_requests) * 100
          : 0,
      avg_duration:
        row.total_requests > 0 ? row.total_duration / row.total_requests : 0,
      p95_duration: row.p95_duration,
      p99_duration: row.p99_duration,
    };

    return withRpsRpm(range, base);
  }

  // ─── Maintenance ────────────────────────────────────────────────────────

  deleteOlderThan(timestamp: number): void {
    const filter = { timestamp: { $lt: timestamp } };
    fireAndForget(
      Promise.all([
        this.systemCol.deleteMany(filter),
        this.processCol.deleteMany(filter),
        this.endpointCol.deleteMany(filter),
        this.errorCol.deleteMany(filter),
      ]),
      "MongoDB deleteOlderThan",
    );
  }

  // ─── Settings ───────────────────────────────────────────────────────────

  async getSetting(key: string): Promise<string | null> {
    const doc = await this.settingsCol.findOne({ key });
    return doc?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    fireAndForget(
      this.settingsCol.updateOne(
        { key },
        { $set: { key, value } },
        { upsert: true },
      ),
      "MongoDB setSetting",
    );
  }

  // ─── Auth ───────────────────────────────────────────────────────────────

  async getUser(
    username: string,
  ): Promise<{ username: string; password_hash: string } | null> {
    const doc = await this.authCol.findOne({ username });
    if (!doc) return null;
    return { username: doc.username, password_hash: doc.password_hash };
  }

  createUser(username: string, passwordHash: string): void {
    fireAndForget(
      this.authCol.insertOne({
        username,
        password_hash: passwordHash,
        created_at: Date.now(),
      }),
      "MongoDB createUser",
    );
  }

  updateUserPassword(username: string, passwordHash: string): void {
    fireAndForget(
      this.authCol.updateOne(
        { username },
        { $set: { password_hash: passwordHash } },
      ),
      "MongoDB updateUserPassword",
    );
  }
}
