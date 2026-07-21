import os from "os";

/**
 * Resolve a stable per-container instance identifier.
 * Works on App Runner, Cloud Run, Kubernetes, etc. — no process manager assumptions.
 *
 * Order: config → LOADFLUX_INSTANCE_ID → HOSTNAME → os.hostname()
 */
export function resolveInstanceId(configured?: string): string {
  const fromConfig = configured?.trim();
  if (fromConfig) return fromConfig;

  const fromEnv = process.env.LOADFLUX_INSTANCE_ID?.trim();
  if (fromEnv) return fromEnv;

  const fromHostname = process.env.HOSTNAME?.trim();
  if (fromHostname) return fromHostname;

  return os.hostname();
}
