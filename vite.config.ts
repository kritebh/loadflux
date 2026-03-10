import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  root: "ui",
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
  },
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, "dist-ui"),
    emptyOutDir: true,
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
});
