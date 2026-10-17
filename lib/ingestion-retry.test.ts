import assert from "node:assert/strict";
import test from "node:test";
import { nextHourlyRetry } from "./ingestion-retry";

test("retry is due at the next hourly tick even when a failure happens just after the hour", () => {
  assert.equal(nextHourlyRetry(Date.parse("2026-10-17T12:00:03Z")), "2026-10-17T13:00:00.000Z");
  assert.equal(nextHourlyRetry(Date.parse("2026-10-17T12:59:59Z")), "2026-10-17T13:00:00.000Z");
});
