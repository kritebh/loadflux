export function createRouteExcluder(excludeRoutes: string[]) {
  const excludeSet = new Set(excludeRoutes);
  const excludePrefixes = excludeRoutes
    .filter((route) => route.endsWith("*"))
    .map((route) => route.replace(/\/\*+$/, ""));

  return function isExcluded(path: string): boolean {
    if (excludeSet.has(path)) return true;
    return excludePrefixes.some(
      (prefix) => path === prefix || path.startsWith(prefix + "/"),
    );
  };
}
