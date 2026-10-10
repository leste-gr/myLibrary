/** Login only resumes known application routes; never follow user-supplied origins. */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string" || /[\\\r\n]/.test(value)) return null;
  try {
    const url = new URL(value, "https://mylibrary.invalid");
    if (url.origin !== "https://mylibrary.invalid" || !value.startsWith("/")) return null;
    if (url.pathname !== "/oauth/consent" && url.pathname !== "/shelfies" && !/^\/shelfies\/review\/[0-9a-f-]{36}$/i.test(url.pathname)) return null;
    return url.pathname + url.search;
  } catch { return null; }
}
