export function ensureSampleSize(maxPoints?: number): number | null {
  if (!maxPoints || !Number.isFinite(maxPoints) || maxPoints < 2) return null;
  return Math.floor(maxPoints);
}

export function normalizeSearchTerm(search?: string): string | null {
  const value = search?.trim();
  return value ? value : null;
}

export type StatusFilter =
  | { kind: "all" }
  | { kind: "range"; min: number; max: number }
  | { kind: "exact"; code: number };

export function parseStatusFilter(status?: string): StatusFilter {
  const value = status?.trim();
  if (!value || value === "all") return { kind: "all" };
  if (value === "4xx") return { kind: "range", min: 400, max: 499 };
  if (value === "5xx") return { kind: "range", min: 500, max: 599 };
  const exact = parseInt(value, 10);
  if (Number.isFinite(exact) && exact >= 100 && exact <= 599) {
    return { kind: "exact", code: exact };
  }
  return { kind: "all" };
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Escape `%`, `_`, and `\` for SQL LIKE patterns with ESCAPE '\\'. */
export function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}
