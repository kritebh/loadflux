import { config } from "dotenv";
import express from "express";
import { loadflux } from "../dist/index.mjs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.example") });

console.log(process.env.LOADFLUX_PASSWORD);

const app = express();

// Mount loadflux - dashboard at /loadflux, API at /loadflux/api/*
app.use(
  loadflux({
    path: "/loadflux",
    auth: {
      username: process.env.LOADFLUX_USERNAME || "admin",
      password: process.env.LOADFLUX_PASSWORD || "admin123",
    },
  }),
);

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

const PORT = 3456;
app.listen(PORT, () => {
  console.log(`\nTest server running on http://localhost:${PORT}`);
  console.log(`\nLoadFlux API endpoints:`);
  console.log(
    `  Login:         POST http://localhost:${PORT}/loadflux/api/login`,
  );
  console.log(
    `  Overview:      GET  http://localhost:${PORT}/loadflux/api/overview`,
  );
  console.log(
    `  System:        GET  http://localhost:${PORT}/loadflux/api/system`,
  );
  console.log(
    `  Process:       GET  http://localhost:${PORT}/loadflux/api/process`,
  );
  console.log(
    `  Endpoints:     GET  http://localhost:${PORT}/loadflux/api/endpoints`,
  );
  console.log(
    `  Top endpoints: GET  http://localhost:${PORT}/loadflux/api/endpoints/top?metric=request_count`,
  );
  console.log(
    `  Slow requests: GET  http://localhost:${PORT}/loadflux/api/endpoints/slow`,
  );
  console.log(
    `  Errors:        GET  http://localhost:${PORT}/loadflux/api/errors`,
  );
  console.log(
    `  Status dist:   GET  http://localhost:${PORT}/loadflux/api/errors/distribution`,
  );
  console.log(
    `  Live snapshot: GET  http://localhost:${PORT}/loadflux/api/snapshot`,
  );
  console.log(
    `  SSE stream:    GET  http://localhost:${PORT}/loadflux/api/sse`,
  );
  console.log(
    `  Export:        GET  http://localhost:${PORT}/loadflux/api/export`,
  );
  console.log(
    `  Settings:      GET  http://localhost:${PORT}/loadflux/api/settings`,
  );
  console.log(`\nSample app routes (generate metrics by hitting these):`);
  console.log(`  http://localhost:${PORT}/`);
  console.log(`  http://localhost:${PORT}/api/users`);
  console.log(`  http://localhost:${PORT}/api/users/1`);
  console.log(`  http://localhost:${PORT}/api/slow`);
  console.log(`  http://localhost:${PORT}/api/error`);
  console.log(`  http://localhost:${PORT}/api/notfound`);
});
