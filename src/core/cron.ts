import cron from "node-cron";
import type { DatabaseAdapter, ResolvedConfig } from "../types.js";

let task: cron.ScheduledTask | null = null;

export function startRetentionCron(
  db: DatabaseAdapter,
  config: ResolvedConfig
): void {
  task = cron.schedule(config.retention.cronExpression, async () => {
    try {
      const retentionDays =
        (await db.getSetting("retention_days")) ??
        String(config.retention.days);
      const days = parseInt(retentionDays, 10);
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      db.deleteOlderThan(cutoff);
    } catch (err) {
      console.error("[LoadFlux] Retention cleanup failed:", err);
    }
  });
}

export function stopRetentionCron(): void {
  task?.stop();
  task = null;
}
