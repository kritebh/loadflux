---
sidebar_position: 2
---

# Monitoring Endpoints

LoadFlux automatically captures metrics for every HTTP request that passes through the middleware.

## What gets captured

For each request, LoadFlux records:

| Metric | Description |
|---|---|
| `method` | HTTP method (GET, POST, etc.) |
| `path` | Route pattern (e.g., `/api/users/:id`) |
| `statusCode` | Response status code |
| `durationMs` | Request duration in milliseconds (nanosecond precision) |
| `responseBytes` | Response body size from `Content-Length` header |
| `timestamp` | When the request occurred |

## Route normalization

LoadFlux groups requests by route pattern, not by URL:

- Express: Uses `req.route.path` (e.g., `/api/users/:id`)
- Fastify: Uses `request.routeOptions.url` (e.g., `/api/users/:id`)

This means `/api/users/1`, `/api/users/2`, and `/api/users/999` all appear as a single `/api/users/:id` entry in the dashboard.

## Aggregation

Raw request data is buffered in memory and flushed to the database every 5 seconds (configurable via `collection.aggregationWindow`). During each flush, LoadFlux computes:

- **Request count** and **error count**
- **Latency percentiles**: p50, p90, p95, p99
- **Min/max/avg duration**
- **Status code distribution**: 2xx, 3xx, 4xx, 5xx counts
- **Total response bytes**

The buffer uses a swap pattern — a new buffer is created before the old one is flushed, so there's zero blocking on the hot path.

## Slow requests

Requests exceeding the `slowRequestThreshold` (default: 500ms) are highlighted in the Endpoints page under "Slow Requests". You can adjust this threshold in code or from the Settings page in the dashboard.

## Error tracking

Responses with status codes >= 400 are logged in the error log with:

- Timestamp, method, and path
- Status code
- Error message (from response body if available)
- Stack trace (if available)
- Request duration

View these in the Errors page of the dashboard.

## Excluding routes

To exclude specific routes from monitoring:

```typescript
app.use(loadflux({
  excludeRoutes: ["/health", "/ready", "/metrics"],
}));
```

Excluded routes won't appear in the dashboard or affect any metrics.

## Performance

The middleware adds < 0.5ms overhead per request:

- **Express**: Uses `process.hrtime.bigint()` for nanosecond timing, captures metrics in the `res.finish` event
- **Fastify**: Uses Fastify's built-in `reply.elapsedTime` and the `onResponse` hook

LoadFlux's own routes (`/loadflux/*`) are not counted in metrics.
