/**
 * Helper utilities for Grafana Pyroscope continuous profiling.
 */

export async function withProfileLabels<T>(
  labels: Record<string, string | number>,
  fn: () => Promise<T> | T
): Promise<T> {
  if (typeof window === "undefined" && process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const pyroscope = await import("@pyroscope/nodejs");
      let result: T;
      pyroscope.wrapWithLabels(labels, async () => {
        result = await fn();
      });
      // @ts-expect-error result is assigned inside wrapper
      return result;
    } catch {
      // Fallback if pyroscope is unavailable
      return await fn();
    }
  }
  return await fn();
}
