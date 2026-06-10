# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview (at a glance)

**LoadFlux** is an npm package that embeds a small **Grafana-like monitoring dashboard** into an existing **Node.js** app (Express or Fastify). It runs **in-process** (no extra daemon): middleware records request latency and errors, collectors sample CPU/RAM/disk/network (and process metrics), data is stored in **SQLite** by default or **MongoDB** optionally, and a **pre-built React UI** is served under a configurable base path (default `/loadflux`). **SSE** pushes live snapshots to the UI; historical views use REST queries with **custom from/to date-time ranges** (default rolling last hour). The **Endpoints** and **Errors** pages support **debounced search**; **Errors** also filters by HTTP status. System charts **downsample** wide ranges for performance. Auth is optional at install time and can be managed from the dashboard.

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

### Dual build system

- **Server** (`src/`): Built with **tsup** → `dist/` (CJS + ESM + declarations). Entry: `src/index.ts`
- **Dashboard UI** (`ui/`): Built with **Vite + React** → `dist-ui/` (static assets served by the server at runtime). The UI source is **not** shipped in the npm package — only the pre-built output.
- **Vitest** config lives in `vite.config.ts` under the `test` key (root `.`, includes `tests/**/*.test.ts`).

### Server-side structure (`src/`)

| Area | Purpose |
|------|---------|
| `src/types.ts` | Shared TS types: config, DB rows, query types, `DatabaseAdapter`, `DashboardSnapshot` |
| `src/config.ts` | `resolveConfig()` — merges defaults, env, validates intervals and retention |
| `src/core/` | `Aggregator` (in-memory buffer, configurable flush window), `SystemCollector` (CPU/RAM/disk/network; Linux RAM from `/proc/meminfo` when available), `ProcessCollector`, `MetricsStore`, `cron.ts` (retention), `linux-meminfo.ts`, `listen-host.ts` |
| `src/db/` | `DatabaseAdapter` + `SQLiteAdapter`, `MongoDBAdapter` (optional peer). Migrations embedded in `sqlite.ts` |
| `src/middleware/` | Express middleware + Fastify plugin — hot path, keep overhead minimal |
| `src/api/router.ts` | Internal REST at `{path}/api/*`: system, endpoints, errors, overview, settings, SSE, export, auth; list endpoints support optional `search` (and errors `status`); login rate limiting uses client IP (`trustProxy` affects IP resolution) |
| `src/auth/` | bcrypt password hashing, HMAC session tokens, cookie + Bearer; `setupInitialAuth` syncs config password hash on startup |
| `src/server/` | Static file serving for the pre-built dashboard |

### Dashboard UI structure (`ui/`)

React 19 + Tailwind + Chart.js. Vite root is `ui/`.

| Area | Purpose |
|------|---------|
| `ui/src/pages/` | Login, Dashboard, System, Endpoints, AppMetrics, Errors, Settings |
| `ui/src/components/` | Charts (TimeSeries, Bar, Doughnut, …), layout, `TimeRangeSelector`, shared `icons` |
| `ui/src/hooks/` | `useSSE`, `useMetrics` (polling + time range), `useDebouncedValue`, `useTheme` |
| `ui/src/api/client.ts` | Fetch wrapper, SSE, API helpers |
| `ui/src/utils/downsample.ts` | Index-based downsampling for large time series (e.g. System page) |

### Key design patterns

- **DatabaseAdapter**: Interface in `src/types.ts`; SQLite default, MongoDB optional peer. Both implement full surface including `updateUserPassword`.
- **In-memory aggregator**: Buffers by `"METHOD:path"`; flush interval = `collection.aggregationWindow` (default 5s). Percentiles computed on flush; buffer swap avoids blocking the request path.
- **SSE**: Pushes `DashboardSnapshot` on an interval to connected dashboards (includes system, process, overview, endpoints, server meta).
- **Middleware timing**: `process.hrtime.bigint()` (Express), `reply.elapsedTime` (Fastify). Route normalization: `req.route.path` / `request.routeOptions.url`.
- **Fastify**: LoadFlux registers in an encapsulated context with body parsers removed so POST bodies (login, settings) are read manually — otherwise those routes can hang.
- **Auth startup sync**: If `.env` / config password changes, DB hash is updated on startup to avoid lockout.
- **Linux system metrics**: RAM prefers `/proc/meminfo` (`MemAvailable` or fallback `MemFree`) via `memoryFromProcMeminfo()`; non-Linux uses `os.totalmem` / `os.freemem`. Network I/O from `/proc/net/dev` on Linux only; elsewhere network counters may be zero. Disk via `fs.statfsSync("/")` (Node 18.15+).
- **Retention**: `node-cron` runs `runRetentionCleanup()` on `config.retention.cronExpression` (default 2:00 daily). Cutoff uses `retention_days` from DB settings when set, else config `retention.days`. `runRetentionCleanup` is exported from `cron.ts` for unit tests.
- **`disableOnLocalhost`**: When `true` and `listenHost` is loopback (`127.0.0.1`, `::1`, `localhost`, … per `isLoopbackListenHost()`), LoadFlux is a no-op — useful so dev servers do not mount the dashboard. `listenHost` comes from config `listenHost`, then `LOADFLUX_LISTEN_HOST`, then `HOST`.
- **`trustProxy`**: When true (or `LOADFLUX_TRUST_PROXY`), login rate limiting uses `X-Forwarded-For` — only enable behind a **trusted** reverse proxy.
- **SQLite migrations**: Versioned in `src/db/sqlite.ts`, additive only; version in `settings` table.

### Target API

```typescript
// Express
import { loadflux } from "loadflux";
app.use(loadflux({ auth: { username: "admin", password: "secret" } }));

// Fastify
import { loadfluxFastify } from "loadflux";
app.register(loadfluxFastify({ path: "/monitor" }));

// NestJS works via Express/Fastify adapters
```

### Dependencies

Runtime: `better-sqlite3`, `bcryptjs`, `node-cron`, `on-headers`  
Optional peer: `mongodb` (see `package.json` peer range)  
`better-sqlite3` and `mongodb` are **external** in the tsup bundle.

## Testing

Vitest (`vite.config.ts`). Layout:

- **`tests/unit/`** — config, sqlite, aggregator, collectors, auth, pagination, **time-filter** (API time-range behavior), **retention-cron**, **linux-meminfo**, **listen-host**, etc.
- **`tests/e2e/`** — Express/Fastify with LoadFlux mounted: login, API, metrics recording

E2E uses temp SQLite under `os.tmpdir()` and cleans up. Allow ~2s for aggregator flushes in timing-sensitive assertions.

## Environment variables

See `.env.example`:

| Variable | Role |
|----------|------|
| `LOADFLUX_USERNAME` / `LOADFLUX_PASSWORD` | Default auth when passed through app config |
| `LOADFLUX_LISTEN_HOST` | Bind host hint for `disableOnLocalhost` (should match `app.listen` host); falls back to `HOST` if unset |
| `HOST` | Same role as `LOADFLUX_LISTEN_HOST` when the latter is not set |
| `LOADFLUX_TRUST_PROXY` | `1` / `true` / `yes` → trust `X-Forwarded-For` for login rate limiting |

Same options exist on `LoadFluxConfig` as `listenHost`, `trustProxy`, `disableOnLocalhost` (see `src/types.ts`).
