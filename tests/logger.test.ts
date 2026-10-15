import assert from "node:assert/strict";
import test from "node:test";
import { logger } from "../lib/logger.ts";

test("logger emits info, warn, and debug messages without throwing", () => {
  assert.doesNotThrow(() => {
    logger.debug("Test debug message", { sample: 123 });
    logger.info("Test info message", { user: "dr_smith" });
    logger.warn("Test warn message", { warningCode: "SLOW_QUERY" });
  });
});

test("logger handles Error objects properly in error()", () => {
  assert.doesNotThrow(() => {
    const error = new Error("Database connection timed out");
    logger.error("Operation failed", error, { query: "SELECT * FROM patients" });
  });
});

test("logger flush resolves cleanly even if no Loki endpoint is reachable", async () => {
  await assert.doesNotReject(async () => {
    logger.info("Message before flush", { test: true });
    await logger.flush();
  });
});
