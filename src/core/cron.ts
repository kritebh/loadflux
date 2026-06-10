import cron from "node-cron";
import type { DatabaseAdapter, ResolvedConfig } from "../types.js";

let task: cron.ScheduledTask | null = null;

/** Same logic as the retention cron job (exported for tests). */
export async function runRetentionCleanup(
  db: DatabaseAdapter,
  config: ResolvedConfig,
): Promise<void> {
  const retentionDays =
    (await db.getSetting("retention_days")) ?? String(config.retention.days);
  const days = parseInt(retentionDays, 10);
  const safeDays =
    Number.isFinite(days) && days >= 1 ? days : config.retention.days;
  const cutoff = Date.now() - safeDays * 24 * 60 * 60 * 1000;
  db.deleteOlderThan(cutoff);
}

export function startRetentionCron(
  db: DatabaseAdapter,
  config: ResolvedConfig
): void {
  task = cron.schedule(config.retention.cronExpression, async () => {
    try {
      await runRetentionCleanup(db, config);
    } catch (err) {
      console.error("[LoadFlux] Retention cleanup failed:", err);
    }
  });
}

export function stopRetentionCron(): void {
  task?.stop();
  task = null;
}
