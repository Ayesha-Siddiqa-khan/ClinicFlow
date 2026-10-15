import { logger } from "@/lib/logger";

export function GET() {
  logger.info("Health check endpoint invoked", { endpoint: "/api/health", status: "ok" });
  return Response.json({ status: "ok" });
}
