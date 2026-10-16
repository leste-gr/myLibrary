import { getTranslations } from "@/lib/i18n/server";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeReturnPath } from "@/lib/safe-return-path";
import { authSiteOrigin, loginErrorPath } from "@/lib/auth-redirects";

export async function GET(request: Request) {
  const t = await getTranslations();
  const url = new URL(request.url);
  const origin = authSiteOrigin();
  const next = safeReturnPath(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  if (code && !url.searchParams.has("error")) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // /login resumes the user's collection directory when no consent is pending.
      return NextResponse.redirect(new URL(next ?? "/login", origin));
    }
  }
  return NextResponse.redirect(new URL(loginErrorPath(t("Sign-in or email confirmation failed or expired. Open the link in the same browser or request a new email."), next), origin));
}
