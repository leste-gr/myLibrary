"use server";
import { getTranslations } from "@/lib/i18n/server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { authSiteOrigin, authCallbackUrl } from "@/lib/auth-redirects";
import { safeReturnPath } from "@/lib/safe-return-path";
import { emailAuthPath, normalizedEmail } from "@/lib/email-auth";

export async function requestPasswordReset(formData: FormData) {
  const t = await getTranslations();
  const next = safeReturnPath(formData.get("next"));
  const email = normalizedEmail(formData.get("email"));
  if (!email) redirect(emailAuthPath("/forgot-password", next, { error: t("Enter a valid email address.") }));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: authCallbackUrl(authSiteOrigin(), emailAuthPath("/reset-password", next)),
  });
  if (error && error.code !== "user_not_found") redirect(emailAuthPath("/forgot-password", next, { error: t("Email delivery is unavailable right now. Please try again later.") }));
  redirect(emailAuthPath("/forgot-password", next, { sent: "1" }));
}
