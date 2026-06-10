/** True when the configured bind host is loopback-only (LoadFlux may skip init). */
export function isLoopbackListenHost(host: string | null | undefined): boolean {
  if (host == null || typeof host !== "string") return false;
  const h = host.trim().toLowerCase();
  if (!h) return false;
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "[::1]" ||
    h === "0:0:0:0:0:0:0:1"
  );
}
