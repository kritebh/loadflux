# LoadFlux

Lightweight, embeddable server monitoring dashboard for Node.js. Drop a single middleware into your Express or Fastify app and get a full Grafana-like dashboard no separate process, no external services.

![Dashboard](https://raw.githubusercontent.com/kritebh/loadflux/refs/heads/main/screenshots/dashboard.png)

## Features

- **Real-time dashboard** with live SSE updates every 2 seconds
- **System metrics** — CPU, memory, disk usage, network I/O
- **App metrics** — heap usage, event loop delay, GC pause time
- **Endpoint analytics** — request count, latency percentiles (p50/p90/p95/p99), error rates
- **Error tracking** — error log with status codes, durations, and stack traces
- **Configurable retention** and slow request thresholds
- **Password-protected** with bcrypt hashing and HMAC-SHA256 session tokens
- **Dark/light theme** with time range selectors (5m to 30d)
- **SQLite by default** (zero-config), optional MongoDB support
- **JSON export** for all metrics
- Works with **Express**, **Fastify**, and **NestJS** (via their underlying framework)

## Quick Start

```bash
npm install loadflux
```

### Express

```typescript
import express from "express";
import { loadflux } from "loadflux";

const app = express();

app.use(loadflux({
  auth: { username: "admin", password: "secret" }
}));

app.get("/api/users", (req, res) => res.json({ users: [] }));

app.listen(3000);
// Dashboard at http://localhost:3000/loadflux
```

### Fastify

```typescript
import Fastify from "fastify";
import { loadfluxFastify } from "loadflux";

const app = Fastify();

app.register(loadfluxFastify({
  path: "/monitor",
  auth: { username: "admin", password: "secret" }
}));

app.get("/api/users", async () => ({ users: [] }));

await app.listen({ port: 3000 });
// Dashboard at http://localhost:3000/monitor
```

## Documentation

For detailed guides, all dashboard pages, configuration reference, and more — visit the full docs:

**[loadflux.dev](https://loadflux.kritebh.dev)**

## Configuration

```typescript
loadflux({
  // Dashboard URL path (default: "/loadflux")
  path: "/loadflux",

  // Authentication credentials
  auth: {
    username: "admin",
    password: "secret",
  },

  // Database backend
  database: {
    adapter: "sqlite",             // "sqlite" (default) or "mongodb"
    connectionString: "./loadflux.db", // SQLite path or MongoDB URI
  },

  // Collection intervals
  collection: {
    systemInterval: 5000,    // System metrics polling (ms)
    aggregationWindow: 5000, // Request aggregation flush (ms)
  },

  // Data retention
  retention: {
    days: 90,                 // Keep metrics for N days
    cronExpression: "0 2 * * *", // Cleanup schedule
  },

  // Flag requests slower than this (ms)
  slowRequestThreshold: 500,

  // Routes to exclude from monitoring
  excludeRoutes: ["/health", "/ready"],
});
```

You can also configure auth via environment variables:

```bash
LOADFLUX_USERNAME=admin
LOADFLUX_PASSWORD=secret
```

## Requirements

- Node.js >= 22.0.0

## Tech Stack

| Component | Technology |
|-----------|------------|
| Server metrics engine | TypeScript, better-sqlite3, node-cron |
| Dashboard UI | React 19, Tailwind CSS, Chart.js |
| Real-time updates | Server-Sent Events (SSE) |
| Auth | bcryptjs + HMAC-SHA256 tokens |
| Build | tsup (server), Vite (UI) |

## Development

```bash
# Install dependencies
npm install

# Build everything (server + UI)
npm run build

# Dev mode (server with watch)
npm run dev

# Dev mode (UI with Vite dev server)
npm run dev:ui

# Run tests
npm test

# Run the example server (requires build first)
node examples/test-server.mjs
```

## License

[MIT](LICENSE)
