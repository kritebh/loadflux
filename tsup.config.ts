import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: process.env.SOURCEMAP === "1",
  external: ["better-sqlite3", "mongodb"],
  outDir: "dist",
});
