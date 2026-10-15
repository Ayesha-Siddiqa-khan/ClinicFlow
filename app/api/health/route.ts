import { logger } from "@/lib/logger";

export async function GET() {
  logger.info("Health check endpoint invoked", { endpoint: "/api/health", status: "ok" });
  await logger.flush();
  return Response.json({ status: "ok" });
}
