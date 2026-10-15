import { safeReturnPath } from "./safe-return-path";

/** Use configured origins, never forwarded/request host headers, for OAuth redirects. */
export function authSiteOrigin() {
  const value = process.env.MYLIBRARY_SITE_URL;
  if (!value) {
    if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
    throw new Error("MYLIBRARY_SITE_URL is required for sign-in.");
  }
  const url = new URL(value);
  if (url.username || url.password || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && url.hostname === "localhost"))) {
    throw new Error("Invalid sign-in site URL.");
  }
  return url.origin;
}

export function googleCallbackUrl(origin: string, next: unknown) {
  const url = new URL("/auth/callback", origin);
  const path = safeReturnPath(next);
  if (path) url.searchParams.set("next", path);
  return url.toString();
}

export function loginErrorPath(message: string, next: unknown) {
  const params = new URLSearchParams({ error: message });
  const path = safeReturnPath(next);
  if (path) params.set("next", path);
  return `/login?${params}`;
}
