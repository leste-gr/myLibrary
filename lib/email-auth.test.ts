import assert from "node:assert/strict";
import test from "node:test";
import { normalizedEmail, passwordValidationError, emailAuthPath } from "./email-auth";
import { authCallbackUrl } from "./auth-redirects";
import { safeReturnPath } from "./safe-return-path";

test("email registration accepts Yahoo and other providers without a Google dependency", () => {
  assert.equal(normalizedEmail(" leste_gr@yahoo.com "), "leste_gr@yahoo.com");
  assert.equal(normalizedEmail("reader+books@independent.example"), "reader+books@independent.example");
  for (const value of [null, "reader", "a b@example.com", "a@b@example.com", "a@" + "b".repeat(255) + ".com"]) assert.equal(normalizedEmail(value), null);
});

test("registration and password reset reject weak or mismatched passwords", () => {
  for (const value of [null, "", "1234567", "a".repeat(129)]) assert.ok(passwordValidationError(value, value));
  assert.ok(passwordValidationError("correct horse battery", "different password"));
  assert.equal(passwordValidationError("correct horse battery", "correct horse battery"), null);
  assert.ok(passwordValidationError(" password ", "password"), "password whitespace must not be silently changed");
});

test("email registration and recovery preserve plugin consent without accepting open redirects", () => {
  const consent = "/oauth/consent?authorization_id=pending";
  for (const route of ["/register", "/forgot-password", "/login"] as const) {
    const url = new URL(emailAuthPath(route, consent), "https://library.test");
    assert.equal(url.searchParams.get("next"), consent);
  }
  const recovery = emailAuthPath("/reset-password", consent);
  const callback = new URL(authCallbackUrl("https://library.test", recovery));
  assert.equal(callback.searchParams.get("next"), recovery);
  assert.equal(safeReturnPath(recovery), recovery);
  for (const invalid of ["https://evil.test", "//evil.test", "/\\evil.test", "/auth/callback", "/register", "/forgot-password"]) {
    assert.equal(new URL(emailAuthPath("/register", invalid), callback).searchParams.has("next"), false);
  }
});
