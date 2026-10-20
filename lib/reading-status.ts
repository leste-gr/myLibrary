export const READING_STATUSES = ["unread", "read", "radar"] as const;
export type ReadingStatus = typeof READING_STATUSES[number];
export function isReadingStatus(value: unknown): value is ReadingStatus {
  return READING_STATUSES.some(status => status === value);
}
