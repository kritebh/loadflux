import { describe, it, expect } from "vitest";
import { memoryFromProcMeminfo } from "../../src/core/linux-meminfo.js";

describe("memoryFromProcMeminfo", () => {
  it("uses MemAvailable for used memory (Linux-style)", () => {
    const sample = `MemTotal:       8000000 kB
MemFree:        1000000 kB
MemAvailable:   4000000 kB
Buffers:         100000 kB
Cached:         2000000 kB
`;
    const m = memoryFromProcMeminfo(sample);
    expect(m).not.toBeNull();
    expect(m!.total).toBe(8000000 * 1024);
    expect(m!.used).toBe((8000000 - 4000000) * 1024);
    expect(m!.percent).toBe(50);
  });

  it("falls back to MemFree when MemAvailable is absent", () => {
    const sample = `MemTotal:       4000000 kB
MemFree:        1000000 kB
`;
    const m = memoryFromProcMeminfo(sample);
    expect(m).not.toBeNull();
    expect(m!.total).toBe(4000000 * 1024);
    expect(m!.used).toBe(3000000 * 1024);
  });

  it("returns null for empty input", () => {
    expect(memoryFromProcMeminfo("")).toBeNull();
  });
});
