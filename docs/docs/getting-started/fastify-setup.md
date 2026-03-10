---
sidebar_position: 3
---

# Fastify Setup

LoadFlux integrates as a Fastify plugin.

## Basic setup

```typescript
import Fastify from "fastify";
import { loadfluxFastify } from "loadflux";

const app = Fastify();

app.register(loadfluxFastify({
  auth: {
    username: "admin",
    password: "secret",
  },
}));

// Your routes
app.get("/api/users", async () => {
  return [{ id: 1, name: "Alice" }];
});

app.listen({ port: 3000 }, () => {
  console.log("Server running on http://localhost:3000");
  console.log("Dashboard at http://localhost:3000/loadflux");
});
```

## Custom path

```typescript
app.register(loadfluxFastify({
  path: "/monitor",
  auth: { username: "admin", password: "secret" },
}));
```

## Full example

```typescript
import Fastify from "fastify";
import { loadfluxFastify } from "loadflux";

const app = Fastify({ logger: true });

app.register(loadfluxFastify({
  path: "/loadflux",
  auth: {
    username: process.env.LOADFLUX_USERNAME || "admin",
    password: process.env.LOADFLUX_PASSWORD || "password",
  },
  retention: { days: 30 },
  slowRequestThreshold: 1000,
  excludeRoutes: ["/health"],
}));

app.get("/health", async () => "ok");
app.get("/api/users", async () => [{ id: 1, name: "Alice" }]);

app.listen({ port: 3000 });
```

## How it works

The Fastify plugin:

1. **Registers dashboard routes** inside an encapsulated Fastify context with body parsing disabled (so the raw API handler can read POST bodies directly).
2. **Adds an `onResponse` hook** to record metrics for all non-LoadFlux routes. Fastify provides `reply.elapsedTime` for precise request duration.

Route patterns are resolved via `request.routeOptions.url`, so parameterized routes like `/api/users/:id` are grouped correctly.
