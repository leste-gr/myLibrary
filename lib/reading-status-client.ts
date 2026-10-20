// A JSON mutation acknowledges the write without waiting for a new page render.
// Callers already update their local books and roll back failed selections.
async function save(body: object): Promise<{ error?: string; success?: boolean; updated?: number }> {
  const response = await fetch("/api/reading-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok && !result.error) throw new Error("Reading status request failed.");
  return result;
}

export function changeReadingStatus(slug: string, legacyId: string, status: string) {
  return save({ slug, legacyId, status });
}

export function changeBooksReadingStatus(slug: string, legacyIds: string[], status: string) {
  return save({ slug, legacyIds, status });
}
