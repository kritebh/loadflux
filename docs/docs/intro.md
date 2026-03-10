---
sidebar_position: 1
slug: /
---

# Introduction

LoadFlux is a lightweight npm package that embeds a Grafana-like server monitoring dashboard into your existing Node.js server. It runs on the same process no separate services, no external dependencies.

## What it monitors

- **System resources** — CPU usage, memory (RAM), disk space, network I/O
- **API endpoints** — request counts, latency percentiles (p50/p90/p95/p99), error rates, response sizes
- **Process health** — heap usage, event loop delay, GC pauses, uptime
- **Errors** — status code distribution, error logs with stack traces

## Key features

- **One-line setup** — `app.use(loadflux())` and you're done
- **Embedded dashboard** — React UI served at `/loadflux` (configurable)
- **Real-time updates** — Server-Sent Events push metrics every 2 seconds
- **SQLite by default** — zero-config local database, with optional MongoDB support
- **Framework support** — Express, Fastify, and NestJS (via Express/Fastify adapters)
- **Authentication** — password-protected dashboard with HMAC session tokens
- **Data retention** — configurable auto-cleanup (default: 90 days)
- **Dark/light mode** — theme follows system preference or manual toggle
- **< 0.5ms overhead** — minimal impact on your application's hot path

## Preview

![LoadFlux Dashboard](/img/screenshots/dashboard.png)

## Quick start

```bash
npm install loadflux
```

```typescript
import express from "express";
import { loadflux } from "loadflux";

const app = express();
app.use(loadflux({ auth: { username: "admin", password: "secret" } }));
app.listen(3000);
// Dashboard at http://localhost:3000/loadflux
```

Continue to [Installation](/docs/getting-started/installation) for detailed setup instructions.
