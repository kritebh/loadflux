import fs from "fs";
import path from "path";
import os from "os";

export function tmpDbPath(prefix = "loadflux-test"): string {
  return path.join(
    os.tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
}

export function cleanupSqliteDb(dbPath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {
      // ignore
    }
  }
}
