---
sidebar_position: 2
---

# Express Setup

LoadFlux integrates as standard Express middleware.

## Basic setup

```typescript
import express from "express";
import { loadflux } from "loadflux";

const app = express();

app.use(loadflux({
  auth: {
    username: "admin",
    password: "secret",
  },
}));

// Your routes
app.get("/api/users", (req, res) => {
  res.json([{ id: 1, name: "Alice" }]);
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
  console.log("Dashboard at http://localhost:3000/loadflux");
});
```

## Using environment variables

```typescript
import { loadflux } from "loadflux";

app.use(loadflux({
  auth: {
    username: process.env.LOADFLUX_USERNAME || "admin",
    password: process.env.LOADFLUX_PASSWORD || "password",
  },
}));
```

Create a `.env` file:

```env
LOADFLUX_USERNAME=admin
LOADFLUX_PASSWORD=your-secure-password
```

## Custom dashboard path

```typescript
app.use(loadflux({
  path: "/monitor",
  auth: { username: "admin", password: "secret" },
}));
// Dashboard at http://localhost:3000/monitor
```

## Excluding routes from monitoring

Health checks and internal routes can be excluded:

```typescript
app.use(loadflux({
  auth: { username: "admin", password: "secret" },
  excludeRoutes: ["/health", "/ready", "/metrics"],
}));
```

## Full example

```typescript
import express from "express";
import { loadflux } from "loadflux";

const app = express();

app.use(loadflux({
  path: "/loadflux",
  auth: {
    username: process.env.LOADFLUX_USERNAME || "admin",
    password: process.env.LOADFLUX_PASSWORD || "password",
  },
  database: {
    adapter: "sqlite",
    connectionString: "./data/loadflux.db",
  },
  retention: { days: 30 },
  slowRequestThreshold: 1000,
  excludeRoutes: ["/health"],
}));

app.get("/health", (req, res) => res.send("ok"));
app.get("/api/users", (req, res) => res.json([]));
app.get("/api/users/:id", (req, res) => res.json({ id: req.params.id }));

app.listen(3000);
```

## How it works

LoadFlux middleware does two things:

1. **Serves the dashboard** — Requests to `/loadflux` and `/loadflux/*` are handled by LoadFlux (dashboard UI, API, SSE).
2. **Records metrics** — All other requests pass through to your routes. On response finish, LoadFlux records the method, route pattern, status code, duration, and response size with < 0.5ms overhead.

Route patterns are automatically normalized using `req.route.path`, so `/api/users/1` and `/api/users/2` are grouped under `/api/users/:id`.
