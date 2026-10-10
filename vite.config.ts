import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(async ({ mode }) => {
  const plugins: PluginOption[] = [...react()];
  if (mode === "analyze") {
    const { visualizer } = await import("rollup-plugin-visualizer");
    plugins.push(
      visualizer({
        filename: path.resolve(__dirname, "dist-ui/bundle-stats.html"),
        gzipSize: true,
        open: false,
      }),
    );
  }

  return {
    root: "ui",
    base: "./",
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
    },
    plugins,
    build: {
      outDir: path.resolve(__dirname, "dist-ui"),
      emptyOutDir: true,
      target: "es2020",
      sourcemap: false,
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (
              id.includes("node_modules/chart.js") ||
              id.includes("react-chartjs-2")
            ) {
              return "charts";
            }
            if (
              id.includes("node_modules/react-router") ||
              id.includes("node_modules/react-router-dom")
            ) {
              return "router";
            }
            if (id.includes("node_modules/react-dom")) {
              return "react-dom";
            }
            if (id.includes("node_modules/react/")) {
              return "react";
            }
          },
        },
      },
    },
    server: {
      proxy: {
        "/loadflux/api": "http://localhost:3000",
      },
    },
    test: {
      root: ".",
      include: ["tests/**/*.test.ts"],
      globals: true,
      testTimeout: 15000,
    },
  };
});
