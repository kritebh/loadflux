---
sidebar_position: 3
---

# REST API

Authenticated routes live under `{path}/api/*` (default `/loadflux/api`). The dashboard UI uses these; you can call them from scripts or external tools with the same session cookie or Bearer token as login.

Unless noted, endpoints require auth.

## Common query parameters

| Parameter | Used on | Description |
|-----------|---------|-------------|
| `from`, `to` | Most routes | Unix timestamps in **milliseconds** (inclusive range) |
| `page`, `limit` | List routes | Pagination; `page` ≥ 1, `limit` 1–1000 (default 200) |
| `max_points` | `/system`, `/process` | Server-side downsampling cap (10–2000). If omitted and range ≥ 5 days, the server auto-samples to 900 points |
| `instance` | `/system`, `/process` | Filter to one `instance_id`. When cluster mode is on and omitted, responses use cluster aggregate |
| `search` | Endpoints, errors, slow | Case-insensitive substring filter |
| `status` | Errors | Filter error log to one HTTP status code |
| `metric`, `limit` | `/endpoints/top` | Top-endpoint sort key and count (default metric `request_count`, limit 10) |
| `threshold` | `/endpoints/slow` | Slow-request threshold in ms (defaults to configured `slowRequestThreshold`) |

## Routes

### Live

| Method | Path | Description |
|--------|------|-------------|
| GET | `/sse` | Server-Sent Events stream (`DashboardSnapshot` every ~2s). Max **64** concurrent clients per process |
| GET | `/snapshot` | One-shot JSON snapshot (same shape as SSE) |

### Cluster

| Method | Path | Description |
|--------|------|-------------|
| GET | `/instances` | `{ instances: string[] }` — distinct `instance_id` in `from`/`to` |

### Metrics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/system` | System time series (`SystemMetricRow[]` or paginated) |
| GET | `/process` | Process time series (`ProcessMetricRow[]` or paginated) |
| GET | `/endpoints` | Endpoint aggregation rows |
| GET | `/endpoints/top` | Top endpoints by metric |
| GET | `/endpoints/slow` | Slow endpoint windows |
| GET | `/errors` | Error log rows |
| GET | `/errors/status-codes` | `{ codes: number[] }` for the range |
| GET | `/errors/distribution` | Status bucket totals (`StatusDistribution`) |
| GET | `/overview` | Aggregated overview for the range (`OverviewMetrics`) |

### Settings and export

| Method | Path | Description |
|--------|------|-------------|
| GET | `/settings` | `{ retention_days, slow_threshold }` |
| POST | `/settings` | JSON body: optional `retention_days` (≥ 1), `slow_threshold` (≥ 0) |
| GET | `/export` | JSON bundle `{ system, process, endpoints, errors }`; max range **31 days**. In cluster mode, system/process series are cluster-aggregated |

### Auth (unauthenticated where noted)

Login and setup routes are documented in [Authentication](/docs/configuration/authentication). Initial setup uses `POST /auth/setup` when no user exists.

## Example

```bash
# System metrics for the last hour (cluster aggregate when cluster mode enabled)
curl -s -b cookies.txt \
  "http://localhost:3000/loadflux/api/system?from=$(($(date +%s)*1000-3600000))&to=$(($(date +%s)*1000))&max_points=280"

# One replica only
curl -s -b cookies.txt \
  "http://localhost:3000/loadflux/api/system?from=0&to=9999999999999&instance=apprunner-task-a"
```
