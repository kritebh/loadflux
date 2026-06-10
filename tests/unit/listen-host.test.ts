import { describe, it, expect } from "vitest";
import { isLoopbackListenHost } from "../../src/core/listen-host.js";

describe("isLoopbackListenHost", () => {
  it("detects common loopback bind hosts", () => {
    expect(isLoopbackListenHost("127.0.0.1")).toBe(true);
    expect(isLoopbackListenHost("localhost")).toBe(true);
    expect(isLoopbackListenHost("::1")).toBe(true);
    expect(isLoopbackListenHost("[::1]")).toBe(true);
  });

  it("returns false for public or all interfaces", () => {
    expect(isLoopbackListenHost("0.0.0.0")).toBe(false);
    expect(isLoopbackListenHost("192.168.1.1")).toBe(false);
  });

  it("returns false for empty or unset", () => {
    expect(isLoopbackListenHost("")).toBe(false);
    expect(isLoopbackListenHost(null)).toBe(false);
    expect(isLoopbackListenHost(undefined)).toBe(false);
  });
});
