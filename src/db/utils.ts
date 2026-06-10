export function logDbError(context: string, err: unknown): void {
  console.error(`[LoadFlux] ${context} failed:`, err);
}

export function fireAndForget<T>(
  promise: Promise<T>,
  context: string,
): void {
  promise.catch((err) => {
    logDbError(context, err);
  });
}

