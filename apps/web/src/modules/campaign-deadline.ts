import { CAMPAIGN_DURATION_MS, MINUTE_MS } from "../shared/deadline-limits";

function localMinute(timestamp: number) {
  const date = new Date(timestamp);
  return new Date(timestamp - date.getTimezoneOffset() * MINUTE_MS).toISOString().slice(0, 16);
}

export function updateDeadlineBounds(input: HTMLInputElement) {
  const now = Date.now();
  input.min = localMinute(Math.floor(now / MINUTE_MS) * MINUTE_MS + MINUTE_MS);
  input.max = localMinute(Math.floor((now + CAMPAIGN_DURATION_MS) / MINUTE_MS) * MINUTE_MS);
}
