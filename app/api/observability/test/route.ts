import { logger } from "@/lib/logger";
import { profiler } from "@/lib/profiler";

export async function GET() {
  const startTime = Date.now();

  // 1. Start CPU profiling
  await profiler.start();

  // 2. Emit test logs to Loki
  logger.info("Observability verification triggered", {
    route: "/api/observability/test",
    timestamp: new Date().toISOString(),
  });

  logger.warn("Sample warning log for testing Loki LogQL queries", {
    component: "observability-test",
    threshold: 80,
  });

  // 3. Perform a CPU workload to generate profiling samples
  let sum = 0;
  for (let i = 0; i < 5_000_000; i++) {
    sum += Math.sqrt(i);
  }

  // 4. Stop and upload CPU profile to Pyroscope
  const profileUploaded = await profiler.stopAndUpload();

  // 5. Restart profiler for continuous coverage
  await profiler.start();

  // 6. Flush logger to send immediately to Loki
  await logger.flush();

  const durationMs = Date.now() - startTime;

  return Response.json({
    status: "ok",
    message: "Observability test completed",
    durationMs,
    computeResult: Math.round(sum),
    pyroscope: {
      enabled: true,
      profileUploaded,
      serverAddress: process.env.PYROSCOPE_SERVER_ADDRESS || "https://profiles-prod-018.grafana.net",
      appName: process.env.PYROSCOPE_APPLICATION_NAME || "clinic-flow",
    },
  });
}
