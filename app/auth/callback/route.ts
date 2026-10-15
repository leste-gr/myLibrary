import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeReturnPath } from "@/lib/safe-return-path";
import { authSiteOrigin, loginErrorPath } from "@/lib/auth-redirects";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = authSiteOrigin();
  const next = safeReturnPath(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  if (code && !url.searchParams.has("error")) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // /login selects the user's collection when there is no pending OAuth consent.
      return NextResponse.redirect(new URL(next ?? "/login", origin));
    }
  }
  return NextResponse.redirect(new URL(loginErrorPath("Η σύνδεση ή η επιβεβαίωση email δεν ολοκληρώθηκε ή έληξε. Άνοιξε τον σύνδεσμο στον ίδιο browser ή ζήτησε νέο email.", next), origin));
}
