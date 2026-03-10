---
sidebar_position: 1
---

# Installation

## Requirements

- **Node.js** >= 22.0.0
- **Express** >= 4.x or **Fastify** >= 4.x

## Install

```bash
npm install loadflux
```

This installs LoadFlux with its default SQLite database. No additional setup is needed.

### Optional: MongoDB support

If you prefer MongoDB over SQLite, install the MongoDB driver as a peer dependency:

```bash
npm install mongodb
```

Then configure LoadFlux to use it:

```typescript
app.use(loadflux({
  database: {
    adapter: "mongodb",
    connectionString: "mongodb://localhost:27017/loadflux",
  },
}));
```

## What gets installed

LoadFlux bundles everything it needs:

| Dependency | Purpose |
|---|---|
| `better-sqlite3` | Default SQLite database (zero-config) |
| `bcryptjs` | Password hashing for authentication |
| `node-cron` | Scheduled data retention cleanup |
| `on-headers` | Response timing hooks |

The React dashboard UI is pre-built and shipped as static assets — no client-side build step needed.

## Next steps

- [Express setup](/docs/getting-started/express-setup)
- [Fastify setup](/docs/getting-started/fastify-setup)
- [NestJS setup](/docs/getting-started/nestjs-setup)
