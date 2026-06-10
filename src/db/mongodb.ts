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
  buildPaginatedResult,
} from "./constants.js";
import { fireAndForget } from "./utils.js";
import {
  ensureSampleSize,
  normalizeSearchTerm,
  parseStatusFilter,
  escapeRegex,
} from "./query-helpers.js";

type MongoClient = import("mongodb").MongoClient;
type Db = import("mongodb").Db;
type Collection = import("mongodb").Collection;

function toSearchRegex(search?: string): RegExp | null {
  const term = normalizeSearchTerm(search);
  if (!term) return null;
  return new RegExp(escapeRegex(term), "i");
}

function statusQuery(status?: string): number | Record<string, any> | null {
  const filter = parseStatusFilter(status);
  if (filter.kind === "all") return null;
  if (filter.kind === "range") return { $gte: filter.min, $lte: filter.max };
  return filter.code;
}

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

  insertErrorsBatch(errors: ErrorLogRow[]): void {
    if (errors.length === 0) return;
    fireAndForget(
      this.errorCol.insertMany(errors),
      "MongoDB insertErrorsBatch",
    );
  }

  insertSystemAndProcessMetrics(
    system: SystemMetricRow,
    process: ProcessMetricRow,
  ): void {
    this.insertSystemMetrics(system);
    this.insertProcessMetrics(process);
  }

  // ─── Queries ────────────────────────────────────────────────────────────

  async getSystemMetrics(
    range: TimeRange,
    maxPoints?: number,
  ): Promise<SystemMetricRow[]> {
    const sampleSize = ensureSampleSize(maxPoints);
    if (sampleSize) {
      const span = Math.max(range.to - range.from, 1);
      const bucketMs = Math.max(Math.floor(span / sampleSize), 1);
      const docs = await this.systemCol
        .aggregate<SystemMetricRow>([
          { $match: { timestamp: { $gte: range.from, $lte: range.to } } },
          {
            $group: {
              _id: {
                $subtract: [
                  "$timestamp",
                  { $mod: [{ $subtract: ["$timestamp", range.from] }, bucketMs] },
                ],
              },
              timestamp: { $max: "$timestamp" },
              cpu_percent: { $avg: "$cpu_percent" },
              mem_total: { $avg: "$mem_total" },
              mem_used: { $avg: "$mem_used" },
              mem_percent: { $avg: "$mem_percent" },
              disk_total: { $avg: "$disk_total" },
              disk_used: { $avg: "$disk_used" },
              disk_percent: { $avg: "$disk_percent" },
              net_rx_bytes: { $avg: "$net_rx_bytes" },
              net_tx_bytes: { $avg: "$net_tx_bytes" },
            },
          },
          { $sort: { timestamp: 1 } },
          { $project: { _id: 0 } },
        ])
        .toArray();
      return docs.map((row) => ({
        ...row,
        mem_total: Math.round(row.mem_total),
        mem_used: Math.round(row.mem_used),
        disk_total: row.disk_total === null ? null : Math.round(row.disk_total),
        disk_used: row.disk_used === null ? null : Math.round(row.disk_used),
        net_rx_bytes: Math.round(row.net_rx_bytes),
        net_tx_bytes: Math.round(row.net_tx_bytes),
      })) as SystemMetricRow[];
    }

    const docs = await this.systemCol
      .find({ timestamp: { $gte: range.from, $lte: range.to } })
      .sort({ timestamp: 1 })
      .toArray();
    return docs as unknown as SystemMetricRow[];
  }

  async getProcessMetrics(
    range: TimeRange,
    maxPoints?: number,
  ): Promise<ProcessMetricRow[]> {
    const sampleSize = ensureSampleSize(maxPoints);
    if (sampleSize) {
      const span = Math.max(range.to - range.from, 1);
      const bucketMs = Math.max(Math.floor(span / sampleSize), 1);
      const docs = await this.processCol
        .aggregate<ProcessMetricRow>([
          { $match: { timestamp: { $gte: range.from, $lte: range.to } } },
          {
            $group: {
              _id: {
                $subtract: [
                  "$timestamp",
                  { $mod: [{ $subtract: ["$timestamp", range.from] }, bucketMs] },
                ],
              },
              timestamp: { $max: "$timestamp" },
              heap_used: { $avg: "$heap_used" },
              heap_total: { $avg: "$heap_total" },
              external_mem: { $avg: "$external_mem" },
              event_loop_avg_ms: { $avg: "$event_loop_avg_ms" },
              event_loop_max_ms: { $avg: "$event_loop_max_ms" },
              gc_pause_ms: { $avg: "$gc_pause_ms" },
              uptime_seconds: { $avg: "$uptime_seconds" },
            },
          },
          { $sort: { timestamp: 1 } },
          { $project: { _id: 0 } },
        ])
        .toArray();
      return docs.map((row) => ({
        ...row,
        heap_used: Math.round(row.heap_used),
        heap_total: Math.round(row.heap_total),
        external_mem: Math.round(row.external_mem),
      })) as ProcessMetricRow[];
    }

    const docs = await this.processCol
      .find({ timestamp: { $gte: range.from, $lte: range.to } })
      .sort({ timestamp: 1 })
      .toArray();
    return docs as unknown as ProcessMetricRow[];
  }

  async getEndpointMetrics(
    range: TimeRange,
    filter?: QueryFilter,
  ): Promise<EndpointMetricRow[]> {
    const searchRegex = toSearchRegex(filter?.search);
    const query: Record<string, any> = { timestamp: { $gte: range.from, $lte: range.to } };
    if (searchRegex) {
      query.$or = [{ method: searchRegex }, { path: searchRegex }];
    }
    const docs = await this.endpointCol
      .find(query)
      .sort({ timestamp: 1 })
      .toArray();
    return docs as unknown as EndpointMetricRow[];
  }

  async getTopEndpoints(
    metric: TopEndpointMetric,
    limit: number,
    range: TimeRange,
    filter?: QueryFilter,
  ): Promise<TopEndpointRow[]> {
    const searchRegex = toSearchRegex(filter?.search);
    const match: Record<string, any> = { timestamp: { $gte: range.from, $lte: range.to } };
    if (searchRegex) {
      match.$or = [{ method: searchRegex }, { path: searchRegex }];
    }
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
          { $match: match },
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
        { $match: match },
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
    filter?: QueryFilter,
  ): Promise<EndpointMetricRow[]> {
    const searchRegex = toSearchRegex(filter?.search);
    const query: Record<string, any> = {
      timestamp: { $gte: range.from, $lte: range.to },
      avg_duration: { $gt: thresholdMs },
    };
    if (searchRegex) {
      query.$or = [{ method: searchRegex }, { path: searchRegex }];
    }
    const docs = await this.endpointCol
      .find(query)
      .sort({ avg_duration: -1 })
      .toArray();
    return docs as unknown as EndpointMetricRow[];
  }

  async getErrorLog(
    range: TimeRange,
    filter?: QueryFilter,
  ): Promise<ErrorLogRow[]> {
    const searchRegex = toSearchRegex(filter?.search);
    const status = statusQuery(filter?.status);
    const query: Record<string, any> = { timestamp: { $gte: range.from, $lte: range.to } };
    if (status !== null) {
      query.status_code = status;
    }
    if (searchRegex) {
      query.$or = [{ method: searchRegex }, { path: searchRegex }, { error_msg: searchRegex }];
    }
    const docs = await this.errorCol
      .find(query)
      .sort({ timestamp: -1 })
      .toArray();
    return docs as unknown as ErrorLogRow[];
  }

  async getErrorStatusCodes(range: TimeRange): Promise<number[]> {
    const codes = await this.errorCol.distinct("status_code", {
      timestamp: { $gte: range.from, $lte: range.to },
    });
    return (codes as number[]).filter((c) => typeof c === "number").sort((a, b) => a - b);
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

  // ─── Paginated Queries ──────────────────────────────────────────────────

  async getSystemMetricsPaginated(
    range: TimeRange,
    pagination: PaginationParams,
    _maxPoints?: number,
  ): Promise<PaginatedResult<SystemMetricRow>> {
    const filter = { timestamp: { $gte: range.from, $lte: range.to } };
    const [total, docs] = await Promise.all([
      this.systemCol.countDocuments(filter),
      this.systemCol
        .find(filter)
        .sort({ timestamp: 1 })
        .skip((pagination.page - 1) * pagination.limit)
        .limit(pagination.limit)
        .toArray(),
    ]);
    return buildPaginatedResult(docs as unknown as SystemMetricRow[], total, pagination);
  }

  async getProcessMetricsPaginated(
    range: TimeRange,
    pagination: PaginationParams,
    _maxPoints?: number,
  ): Promise<PaginatedResult<ProcessMetricRow>> {
    const filter = { timestamp: { $gte: range.from, $lte: range.to } };
    const [total, docs] = await Promise.all([
      this.processCol.countDocuments(filter),
      this.processCol
        .find(filter)
        .sort({ timestamp: 1 })
        .skip((pagination.page - 1) * pagination.limit)
        .limit(pagination.limit)
        .toArray(),
    ]);
    return buildPaginatedResult(docs as unknown as ProcessMetricRow[], total, pagination);
  }

  async getEndpointMetricsPaginated(
    range: TimeRange,
    pagination: PaginationParams,
    filter?: QueryFilter,
  ): Promise<PaginatedResult<EndpointMetricRow>> {
    const searchRegex = toSearchRegex(filter?.search);
    const query: Record<string, any> = { timestamp: { $gte: range.from, $lte: range.to } };
    if (searchRegex) {
      query.$or = [{ method: searchRegex }, { path: searchRegex }];
    }
    const [total, docs] = await Promise.all([
      this.endpointCol.countDocuments(query),
      this.endpointCol
        .find(query)
        .sort({ timestamp: 1 })
        .skip((pagination.page - 1) * pagination.limit)
        .limit(pagination.limit)
        .toArray(),
    ]);
    return buildPaginatedResult(docs as unknown as EndpointMetricRow[], total, pagination);
  }

  async getSlowRequestsPaginated(
    thresholdMs: number,
    range: TimeRange,
    pagination: PaginationParams,
    filter?: QueryFilter,
  ): Promise<PaginatedResult<EndpointMetricRow>> {
    const searchRegex = toSearchRegex(filter?.search);
    const query: Record<string, any> = {
      timestamp: { $gte: range.from, $lte: range.to },
      avg_duration: { $gt: thresholdMs },
    };
    if (searchRegex) {
      query.$or = [{ method: searchRegex }, { path: searchRegex }];
    }
    const [total, docs] = await Promise.all([
      this.endpointCol.countDocuments(query),
      this.endpointCol
        .find(query)
        .sort({ avg_duration: -1 })
        .skip((pagination.page - 1) * pagination.limit)
        .limit(pagination.limit)
        .toArray(),
    ]);
    return buildPaginatedResult(docs as unknown as EndpointMetricRow[], total, pagination);
  }

  async getErrorLogPaginated(
    range: TimeRange,
    pagination: PaginationParams,
    filter?: QueryFilter,
  ): Promise<PaginatedResult<ErrorLogRow>> {
    const searchRegex = toSearchRegex(filter?.search);
    const status = statusQuery(filter?.status);
    const query: Record<string, any> = { timestamp: { $gte: range.from, $lte: range.to } };
    if (status !== null) {
      query.status_code = status;
    }
    if (searchRegex) {
      query.$or = [{ method: searchRegex }, { path: searchRegex }, { error_msg: searchRegex }];
    }
    const [total, docs] = await Promise.all([
      this.errorCol.countDocuments(query),
      this.errorCol
        .find(query)
        .sort({ timestamp: -1 })
        .skip((pagination.page - 1) * pagination.limit)
        .limit(pagination.limit)
        .toArray(),
    ]);
    return buildPaginatedResult(docs as unknown as ErrorLogRow[], total, pagination);
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

  async hasAnyUser(): Promise<boolean> {
    const doc = await this.authCol.findOne({}, { projection: { _id: 1 } });
    return doc != null;
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
