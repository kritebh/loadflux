/**
 * Tiny round-robin proxy to simulate App Runner / Cloud Run load balancing
 * across multiple local LoadFlux instances with distinct HOSTNAME values.
 */
import http from "http";
import { URL } from "url";

const PORT = Number(process.env.PORT) || 3456;
const UPSTREAMS = (process.env.UPSTREAMS ||
  "http://127.0.0.1:3457,http://127.0.0.1:3458,http://127.0.0.1:3459")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

let cursor = 0;

function nextUpstream() {
  const target = UPSTREAMS[cursor % UPSTREAMS.length];
  cursor += 1;
  return new URL(target);
}

const server = http.createServer((req, res) => {
  const upstream = nextUpstream();
  const headers = { ...req.headers, host: upstream.host };
  // Avoid hop-by-hop issues with keep-alive under load
  delete headers.connection;
  delete headers["keep-alive"];
  headers.connection = "close";

  let settled = false;

  const proxyReq = http.request(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      path: req.url,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
      proxyRes.on("end", () => {
        settled = true;
      });
    },
  );

  proxyReq.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Bad gateway", detail: err.message }));
    } else {
      res.destroy();
    }
  });

  // Only tear down upstream if the *client* aborts mid-flight (e.g. SSE close).
  // Do NOT use req.on("close") — for GET that fires as soon as the request
  // headers are consumed and would kill the upstream response early.
  res.on("close", () => {
    if (!settled && !res.writableEnded) {
      proxyReq.destroy();
    }
  });

  req.pipe(proxyReq);
});

server.listen(PORT, () => {
  console.log(`Load balancer on http://localhost:${PORT}`);
  console.log(`Upstreams: ${UPSTREAMS.join(", ")}`);
});
