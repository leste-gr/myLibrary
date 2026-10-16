import { safeReturnPath } from "./safe-return-path";

export const MIN_PASSWORD_LENGTH = 8;
export function normalizedEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function passwordValidationError(password: unknown, confirmation: unknown) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH || password.length > 128) {
    return "Password must contain 8 to 128 characters.";
  }
  if (password !== confirmation) return "Passwords do not match.";
  return null;
}

export function emailAuthPath(path: "/register" | "/forgot-password" | "/reset-password" | "/login", next: unknown, fields: Record<string, string> = {}) {
  const params = new URLSearchParams(fields);
  const destination = safeReturnPath(next);
  if (destination) params.set("next", destination);
  return path + (params.size ? `?${params}` : "");
}
