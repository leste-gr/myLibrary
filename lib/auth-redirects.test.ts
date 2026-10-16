import assert from "node:assert/strict";
import test from "node:test";
import { authSiteOrigin, authCallbackUrl, loginErrorPath } from "./auth-redirects";
import { safeReturnPath } from "./safe-return-path";

test("Google sign-in preserves the plugin consent request across success and failure", () => {
  const next = "/oauth/consent?authorization_id=pending-authorization";
  const callback = new URL(authCallbackUrl("https://library.test", next));
  assert.equal(callback.origin, "https://library.test");
  assert.equal(callback.pathname, "/auth/callback");
  assert.equal(callback.searchParams.get("next"), next);
  assert.equal(new URL(loginErrorPath("Try again", next), callback).searchParams.get("next"), next);
  assert.equal(safeReturnPath("/?view=mine"), "/?view=mine");
  assert.equal(safeReturnPath("/shelfies/connections"), "/shelfies/connections");
  for (const unsafe of ["https://evil.test", "//evil.test", "/\\evil.test", "/auth/callback", "/login"]) {
    assert.equal(new URL(authCallbackUrl("https://library.test", unsafe)).searchParams.has("next"), false);
    assert.equal(new URL(loginErrorPath("Try again", unsafe), callback).searchParams.has("next"), false);
  }
});

test("production sign-in requires an explicitly configured HTTPS origin", (t) => {
  const previous = process.env.MYLIBRARY_SITE_URL;
  const previousNodeEnv = process.env.NODE_ENV;
  t.after(() => {
    if (previous === undefined) delete process.env.MYLIBRARY_SITE_URL;
    else process.env.MYLIBRARY_SITE_URL = previous;
    if (previousNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", previousNodeEnv);
  });
  Reflect.set(process.env, "NODE_ENV", "production");
  delete process.env.MYLIBRARY_SITE_URL;
  assert.throws(authSiteOrigin, /required/);
  for (const invalid of ["http://library.test", "https://user:password@library.test", "javascript:alert(1)"]) {
    process.env.MYLIBRARY_SITE_URL = invalid;
    assert.throws(authSiteOrigin);
  }
  process.env.MYLIBRARY_SITE_URL = "https://library.test/";
  assert.equal(authSiteOrigin(), "https://library.test");
});
