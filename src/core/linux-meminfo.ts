/**
 * Parse /proc/meminfo text (Linux). Uses MemAvailable when present (matches
 * `free` / most monitoring tools); falls back to MemFree on older kernels.
 */
export function memoryFromProcMeminfo(meminfo: string): {
  total: number;
  used: number;
  percent: number;
} | null {
  let totalKb = 0;
  let availableKb = 0;
  let memFreeKb = 0;

  for (const line of meminfo.split("\n")) {
    const m = line.match(/^(MemTotal|MemAvailable|MemFree):\s+(\d+)\s+kB/i);
    if (!m) continue;
    const kb = parseInt(m[2], 10) || 0;
    const key = m[1].toLowerCase();
    if (key === "memtotal") totalKb = kb;
    else if (key === "memavailable") availableKb = kb;
    else if (key === "memfree") memFreeKb = kb;
  }

  if (totalKb <= 0) return null;
  const availKb = availableKb > 0 ? availableKb : memFreeKb;
  if (availKb <= 0) return null;

  const total = totalKb * 1024;
  const available = availKb * 1024;
  const used = Math.max(0, total - available);
  return {
    total,
    used,
    percent: Math.round((used / total) * 100 * 100) / 100,
  };
}
