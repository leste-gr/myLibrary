"use server";
import { getTranslations } from "@/lib/i18n/server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { authSiteOrigin, authCallbackUrl } from "@/lib/auth-redirects";
import { safeReturnPath } from "@/lib/safe-return-path";
import { normalizedEmail, passwordValidationError, emailAuthPath } from "@/lib/email-auth";

export async function registerWithEmail(formData: FormData) {
  const t = await getTranslations();
  const next = safeReturnPath(formData.get("next"));
  const email = normalizedEmail(formData.get("email"));
  const password = formData.get("password");
  const validation = passwordValidationError(password, formData.get("confirmPassword"));
  if (!email || validation) redirect(emailAuthPath("/register", next, { error: t(validation ?? "Enter a valid email address.") }));
  if (formData.get("acceptTerms") !== "yes") redirect(emailAuthPath("/register", next, { error: t("Accept the terms of service to continue.") }));
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password: password as string,
    options: { emailRedirectTo: authCallbackUrl(authSiteOrigin(), next) },
  });
  if (error) redirect(emailAuthPath("/register", next, { error: t("Registration could not be completed. Try again later or contact us if the problem continues.") }));
  if (data.session) redirect(next ?? "/login");
  // Supabase may deliberately obscure whether an email already has an account.
  redirect(emailAuthPath("/login", next, { notice: "check-email" }));
}

export async function resendConfirmation(formData: FormData) {
  const t = await getTranslations();
  const next = safeReturnPath(formData.get("next"));
  const email = normalizedEmail(formData.get("email"));
  if (!email) redirect(emailAuthPath("/login", next, { error: t("Enter a valid email address.") }));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: authCallbackUrl(authSiteOrigin(), next) } });
  // Unknown/confirmed addresses get the same result; only delivery/rate limits differ.
  if (error && !["user_not_found", "email_already_confirmed"].includes(error.code ?? "")) redirect(emailAuthPath("/login", next, { error: t("Email delivery is unavailable right now. Please try again later.") }));
  redirect(emailAuthPath("/login", next, { notice: "check-email" }));
}
