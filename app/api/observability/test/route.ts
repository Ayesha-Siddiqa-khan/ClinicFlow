import { logger } from "@/lib/logger";
import { withProfileLabels } from "@/lib/profiler";

export async function GET() {
  const startTime = Date.now();

  // 1. Emit test logs to Loki
  logger.info("Observability verification triggered", {
    route: "/api/observability/test",
    timestamp: new Date().toISOString(),
  });

  logger.warn("Sample warning log for testing Loki LogQL queries", {
    component: "observability-test",
    threshold: 80,
  });

  // 2. Perform a small CPU calculation with Pyroscope label
  const computeResult = await withProfileLabels({ test: "observability-bench" }, () => {
    let sum = 0;
    for (let i = 0; i < 200_000; i++) {
      sum += Math.sqrt(i);
    }
    return sum;
  });

  // 3. Flush logger to send immediately to Loki
  await logger.flush();

  const durationMs = Date.now() - startTime;

  return Response.json({
    status: "ok",
    message: "Observability test completed",
    durationMs,
    computeResult: Math.round(computeResult),
    loki: {
      host: process.env.LOKI_HOST || "not configured (console only)",
      appName: process.env.OTEL_SERVICE_NAME || process.env.LOKI_APP_NAME || "clinic-flow",
    },
    pyroscope: {
      enabled: process.env.PYROSCOPE_ENABLED === "true" || Boolean(process.env.PYROSCOPE_SERVER_ADDRESS),
      serverAddress: process.env.PYROSCOPE_SERVER_ADDRESS || "http://localhost:4040",
      appName: process.env.PYROSCOPE_APPLICATION_NAME || "clinic-flow",
    },
  });
}
