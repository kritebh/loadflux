import { describe, it, expect } from "vitest";
import { aggregateSystemRows } from "../../src/db/cluster-helpers";
import type { SystemMetricRow } from "../../src/types";

const GB = 1024 ** 3;

function row(overrides: Partial<SystemMetricRow>): SystemMetricRow {
  return {
    timestamp: 1_000,
    cpu_percent: 0,
    mem_total: 8 * GB,
    mem_used: 0,
    mem_percent: 0,
    disk_total: null,
    disk_used: null,
    disk_percent: null,
    net_rx_bytes: 0,
    net_tx_bytes: 0,
    ...overrides,
  };
}

describe("aggregateSystemRows", () => {
  it("never reports memory above 100% for near-full replicas", () => {
    const agg = aggregateSystemRows([
      row({ mem_used: 7.9 * GB }),
      row({ mem_used: 7.9 * GB }),
      row({ mem_used: 7.9 * GB }),
    ]);
    expect(agg.mem_percent).toBeLessThanOrEqual(100);
    expect(agg.mem_percent).toBeCloseTo(98.75, 1);
    expect(agg.mem_total).toBe(24 * GB);
  });

  it("weights memory by each instance's capacity", () => {
    const agg = aggregateSystemRows([
      row({ mem_total: 4 * GB, mem_used: 4 * GB }),
      row({ mem_total: 12 * GB, mem_used: 0 }),
    ]);
    expect(agg.mem_percent).toBe(25);
  });

  it("averages CPU and sums network across instances", () => {
    const agg = aggregateSystemRows([
      row({ cpu_percent: 20, net_rx_bytes: 100, timestamp: 5 }),
      row({ cpu_percent: 40, net_rx_bytes: 50, timestamp: 9 }),
    ]);
    expect(agg.cpu_percent).toBe(30);
    expect(agg.net_rx_bytes).toBe(150);
    expect(agg.timestamp).toBe(9);
  });
});
