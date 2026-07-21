module.exports = {
  apps: [
    {
      name: "loadflux-lb",
      script: "examples/load-balancer.mjs",
      instances: 1,
      exec_mode: "fork",
      env: {
        PORT: "3456",
        UPSTREAMS: "http://127.0.0.1:3457,http://127.0.0.1:3458,http://127.0.0.1:3459",
      },
    },
    // Demo credentials below are for local PM2 demos only — use env vars in real deploys.
    {
      name: "loadflux-a",
      script: "examples/test-server.mjs",
      instances: 1,
      exec_mode: "fork",
      env: {
        PORT: "3457",
        HOSTNAME: "apprunner-task-a",
        MONGODB_URI: "mongodb://127.0.0.1:27017/loadflux",
        LOADFLUX_CLUSTER: "1",
        LOADFLUX_USERNAME: process.env.LOADFLUX_USERNAME || "admin",
        LOADFLUX_PASSWORD: process.env.LOADFLUX_PASSWORD || "admin123",
      },
    },
    {
      name: "loadflux-b",
      script: "examples/test-server.mjs",
      instances: 1,
      exec_mode: "fork",
      env: {
        PORT: "3458",
        HOSTNAME: "apprunner-task-b",
        MONGODB_URI: "mongodb://127.0.0.1:27017/loadflux",
        LOADFLUX_CLUSTER: "1",
        LOADFLUX_USERNAME: process.env.LOADFLUX_USERNAME || "admin",
        LOADFLUX_PASSWORD: process.env.LOADFLUX_PASSWORD || "admin123",
      },
    },
    {
      name: "loadflux-c",
      script: "examples/test-server.mjs",
      instances: 1,
      exec_mode: "fork",
      env: {
        PORT: "3459",
        HOSTNAME: "apprunner-task-c",
        MONGODB_URI: "mongodb://127.0.0.1:27017/loadflux",
        LOADFLUX_CLUSTER: "1",
        LOADFLUX_USERNAME: process.env.LOADFLUX_USERNAME || "admin",
        LOADFLUX_PASSWORD: process.env.LOADFLUX_PASSWORD || "admin123",
      },
    },
  ],
};
