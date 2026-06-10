import { describe, it, expect } from "vitest";
import {
  parseStatusFilter,
  escapeRegex,
  escapeLike,
  normalizeSearchTerm,
} from "../../src/db/query-helpers.js";

describe("query-helpers", () => {
  describe("normalizeSearchTerm", () => {
    it("trimmed non-empty string", () => {
      expect(normalizeSearchTerm("  hello  ")).toBe("hello");
    });

    it("returns null for empty or whitespace", () => {
      expect(normalizeSearchTerm("")).toBeNull();
      expect(normalizeSearchTerm("   ")).toBeNull();
      expect(normalizeSearchTerm(undefined)).toBeNull();
    });
  });

  describe("parseStatusFilter", () => {
    it("parses all, 4xx, 5xx", () => {
      expect(parseStatusFilter("all")).toEqual({ kind: "all" });
      expect(parseStatusFilter("4xx")).toEqual({
        kind: "range",
        min: 400,
        max: 499,
      });
      expect(parseStatusFilter("5xx")).toEqual({
        kind: "range",
        min: 500,
        max: 599,
      });
    });

    it("parses exact status codes", () => {
      expect(parseStatusFilter("404")).toEqual({ kind: "exact", code: 404 });
      expect(parseStatusFilter("500")).toEqual({ kind: "exact", code: 500 });
    });

    it("returns all for invalid values", () => {
      expect(parseStatusFilter("abc")).toEqual({ kind: "all" });
      expect(parseStatusFilter("99")).toEqual({ kind: "all" });
      expect(parseStatusFilter("600")).toEqual({ kind: "all" });
    });
  });

  describe("escapeRegex", () => {
    it("escapes regex special characters", () => {
      expect(escapeRegex("a.b*c?")).toBe("a\\.b\\*c\\?");
      expect(escapeRegex("(test)")).toBe("\\(test\\)");
    });
  });

  describe("escapeLike", () => {
    it("escapes LIKE wildcards and backslash", () => {
      expect(escapeLike("100%")).toBe("100\\%");
      expect(escapeLike("a_b")).toBe("a\\_b");
      expect(escapeLike("path\\dir")).toBe("path\\\\dir");
    });
  });
});
