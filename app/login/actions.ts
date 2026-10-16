"use server";
import { getTranslations } from "@/lib/i18n/server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { authSiteOrigin, authCallbackUrl, loginErrorPath } from "@/lib/auth-redirects";
import { safeReturnPath } from "@/lib/safe-return-path";

export async function signIn(formData: FormData) {
  const t = await getTranslations();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeReturnPath(formData.get("next"));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect("/login?error=" + encodeURIComponent(t("Invalid email or password. Confirm your email before logging in.")) + (next ? "&next=" + encodeURIComponent(next) : ""));
  if (next) redirect(next);
  redirect("/?view=mine");
}

export async function signInWithGoogle(formData: FormData) {
  const t = await getTranslations();
  const next = safeReturnPath(formData.get("next"));
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: authCallbackUrl(authSiteOrigin(), next),
      queryParams: { prompt: "select_account" },
      skipBrowserRedirect: true,
    },
  });
  if (error || !data.url) redirect(loginErrorPath(t("Google sign-in is unavailable right now. Please try again."), next));
  redirect(data.url);
}
