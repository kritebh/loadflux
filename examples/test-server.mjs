import { config } from "dotenv";
import express from "express";
import { loadflux } from "../dist/index.mjs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.example") });

const PORT = Number(process.env.PORT) || 3456;
const mongoUri =
  process.env.MONGODB_URI ||
  process.env.LOADFLUX_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/loadflux";

const clusterEnabled =
  process.env.LOADFLUX_CLUSTER === "1" ||
  process.env.LOADFLUX_CLUSTER === "true";

const app = express();

// Mount loadflux - dashboard at /loadflux, API at /loadflux/api/*
app.use(
  loadflux({
    path: "/loadflux",
    auth: {
      username: process.env.LOADFLUX_USERNAME || "admin",
      password: process.env.LOADFLUX_PASSWORD || "admin123",
    },
    ...(clusterEnabled
      ? {
          database: {
            adapter: "mongodb",
            connectionString: mongoUri,
          },
          cluster: {
            enabled: true,
          },
          // Only enable behind a reverse proxy that overwrites X-Forwarded-For.
          // Not required for cluster mode itself.
          trustProxy: process.env.LOADFLUX_TRUST_PROXY === "1",
          excludeRoutes: ["/health"],
        }
      : {}),
  }),
);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Sample API routes to generate metrics
app.get("/", (req, res) => {
  res.json({ message: "Hello World" });
});

app.get("/api/users", (req, res) => {
  // Simulate some latency
  setTimeout(() => {
    res.json([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);
  }, Math.random() * 100);
});

app.get("/api/users/:id", (req, res) => {
  setTimeout(() => {
    res.json({ id: req.params.id, name: "Alice" });
  }, Math.random() * 50);
});

app.post("/api/users", (req, res) => {
  res.status(201).json({ id: 3, name: "Charlie" });
});

app.get("/api/slow", (req, res) => {
  // Intentionally slow endpoint
  setTimeout(() => {
    res.json({ message: "slow response" });
  }, 600);
});

app.get("/api/error", (req, res) => {
  res.status(500).json({ error: "Internal Server Error" });
});

app.get("/api/notfound", (req, res) => {
  res.status(404).json({ error: "Not Found" });
});

app.listen(PORT, () => {
  console.log(`\nTest server running on http://localhost:${PORT}`);
  if (clusterEnabled) {
    console.log(`  MongoDB: ${mongoUri}`);
    console.log(`  Cluster: enabled`);
  }
  console.log(`\nDashboard: http://localhost:${PORT}/loadflux`);
  console.log(`\nSample app routes (generate metrics by hitting these):`);
  console.log(`  http://localhost:${PORT}/`);
  console.log(`  http://localhost:${PORT}/api/users`);
  console.log(`  http://localhost:${PORT}/api/users/1`);
  console.log(`  http://localhost:${PORT}/api/slow`);
  console.log(`  http://localhost:${PORT}/api/error`);
  console.log(`  http://localhost:${PORT}/api/notfound`);
});
