// Align retries with the next hourly scheduler tick, rather than skipping a tick
// when a lookup fails a few seconds after the current hour started.
export function nextHourlyRetry(now = Date.now()) {
  return new Date((Math.floor(now / 3_600_000) + 1) * 3_600_000).toISOString();
}
