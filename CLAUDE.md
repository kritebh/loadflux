# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LoadFlux is a lightweight npm package that embeds a Grafana-like server monitoring dashboard into existing Node.js servers. It runs on the same server (no separate process), serving a React dashboard at a configurable path (default `/loadflux`). It monitors system resources (CPU, RAM, disk, network), API endpoint metrics with percentile latencies (p50/p90/p95/p99), and errors.

## Commands

```bash
# Build everything (server + UI)
npm run build

# Build server-side only (tsup -> dist/)
npm run build:server

# Build dashboard UI only (vite -> dist-ui/)
npm run build:ui

# Dev mode with watch (server)
npm run dev

# Dev mode for UI (vite dev server)
npm run dev:ui

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run a single test file
npx vitest run tests/unit/config.test.ts

# Run only unit tests
npx vitest run tests/unit/

# Run only E2E tests
npx vitest run tests/e2e/

# Run the example test server (requires build first)
node examples/test-server.mjs
```

## Architecture

### Dual Build System
- **Server** (`src/`): Built with **tsup** -> `dist/` (CJS + ESM + declarations). Entry: `src/index.ts`
- **Dashboard UI** (`ui/`): Built with **Vite + React** -> `dist-ui/` (static assets served by the server at runtime). The UI source is NOT shipped in the npm package -- only the pre-built output.
- **Vitest config** lives in `vite.config.ts` under the `test` key (root set to `.`, includes `tests/**/*.test.ts`).

### Server-Side Structure (`src/`)

| Directory | Purpose |
|-----------|---------|
| `src/types.ts` | All shared TypeScript interfaces -- config, DB rows, query types, adapter interface, `DashboardSnapshot` |
| `src/core/` | Metrics engine: `Aggregator` (in-memory buffer with 5s flush), `SystemCollector` (os module), `ProcessCollector` (heap/GC/event loop), `MetricsStore` (orchestrator + snapshot builder), `cron.ts` (retention cleanup) |
| `src/db/` | `DatabaseAdapter` interface + implementations: `SQLiteAdapter` (better-sqlite3), `MongoDBAdapter` (optional peer dep). Migrations embedded in `sqlite.ts` |
| `src/middleware/` | Framework adapters: Express middleware + Fastify plugin. Hot path -- must add < 0.5ms overhead |
| `src/api/router.ts` | Single-file internal REST API at `{path}/api/*`: system, endpoints, errors, overview, settings, SSE, export, auth |
| `src/auth/` | bcryptjs password hashing + HMAC-SHA256 session tokens. `setupInitialAuth` syncs config password to DB on startup |
| `src/server/` | Static file serving for the pre-built React dashboard |

### Dashboard UI Structure (`ui/`)

React 19 + Tailwind CSS + Chart.js. Vite root is `ui/`.

| Directory | Purpose |
|-----------|---------|
| `ui/src/pages/` | 7 pages: Login, Dashboard, System, Endpoints, AppMetrics, Errors, Settings |
| `ui/src/components/` | Reusable: charts (TimeSeries, Gauge, Bar, Doughnut), cards (StatCard), tables (MetricsTable), Layout, Sidebar, ThemeToggle, TimeRangeSelector |
| `ui/src/hooks/` | useSSE (shared via context), useMetrics (polling + time range), useTheme |
| `ui/src/api/client.ts` | Fetch wrapper, SSE connection, all API functions, client-side type mirrors |

### Key Design Patterns

- **DatabaseAdapter pattern**: Interface in `src/types.ts`, implementations in `src/db/`. SQLite is default (zero-config), MongoDB is optional peer dependency. Both must implement all methods including `updateUserPassword`.
- **In-memory aggregator**: Raw requests buffered in a `Map<"METHOD:path", RequestRecord[]>`, flushed to DB every 5s with percentile computation. Buffer swap ensures zero blocking on the hot path.
- **SSE for real-time**: Server-Sent Events push `DashboardSnapshot` every 2s to the dashboard. Snapshot includes system, process, overview (with p95/p99), endpoints, and server info (Node version, platform, PID, SSE connection count).
- **Middleware timing**: `process.hrtime.bigint()` for nanosecond precision (Express), `reply.elapsedTime` (Fastify). Route normalization via `req.route.path` (Express) / `request.routeOptions.url` (Fastify).
- **Fastify body parsing**: LoadFlux routes are registered in an encapsulated Fastify context with body parsing disabled (`removeAllContentTypeParsers`), so the raw API handler can read request bodies itself. This is critical -- without it, POST endpoints (login, settings) hang.
- **Auth startup sync**: `setupInitialAuth` compares config password against stored hash on every startup. If the password changed (e.g., user updated `.env`), the DB hash is updated automatically. This prevents lockouts when config changes.
- **Network I/O**: Linux only via `/proc/net/dev`. macOS/Windows return 0. Disk via `fs.statfs()` (Node 18.15+).
- **SQLite migrations**: Versioned migrations embedded in `src/db/sqlite.ts` (not separate SQL files), auto-run on startup. Additive only. Version tracked in `settings` table.

### Target API

```typescript
// Express
import { loadflux } from "loadflux";
app.use(loadflux({ auth: { username: "admin", password: "secret" } }));

// Fastify
import { loadfluxFastify } from "loadflux";
app.register(loadfluxFastify({ path: "/monitor" }));

// NestJS works automatically via Express/Fastify adapters
```

### Dependencies

Runtime: `better-sqlite3`, `bcryptjs`, `node-cron`, `on-headers`
Optional peer: `mongodb` (>=6.0.0)
`better-sqlite3` and `mongodb` are external in the tsup bundle.

## Testing

Tests use **vitest** (configured in `vite.config.ts`) and live under `tests/`:

- `tests/unit/` -- config, sqlite adapter, aggregator, collectors, auth (fast, no server)
- `tests/e2e/` -- full Express and Fastify servers with loadflux mounted, tests login/auth/API/metrics recording

E2E tests use temp SQLite databases in `os.tmpdir()` and clean up after themselves. They need ~2s waits for aggregator flushes.

## Environment Variables

See `.env.example`: `LOADFLUX_USERNAME` and `LOADFLUX_PASSWORD` for auth config.
