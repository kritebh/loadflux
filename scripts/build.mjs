// Runs build:server and build:ui in parallel. Cross-platform replacement for
// shell `&` / `wait`, which don't work under cmd.exe on Windows.
import { spawn } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const tasks = ["build:server", "build:ui"];

const children = tasks.map((script) => {
  const child = spawn(npm, ["run", script], {
    stdio: "inherit",
    // npm.cmd must be run through a shell on Windows (Node >= 18.20 / 20.12).
    shell: process.platform === "win32",
  });
  return new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve({ script, code: code ?? (signal ? 1 : 0) }));
    child.on("error", (err) => {
      console.error(`[build] failed to start ${script}:`, err);
      resolve({ script, code: 1 });
    });
  });
});

const results = await Promise.all(children);
const failed = results.filter((r) => r.code !== 0);
for (const r of failed) console.error(`[build] ${r.script} exited with code ${r.code}`);
process.exit(failed.length ? 1 : 0);
