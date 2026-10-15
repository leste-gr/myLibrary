"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { authSiteOrigin, authCallbackUrl } from "@/lib/auth-redirects";
import { safeReturnPath } from "@/lib/safe-return-path";
import { emailAuthPath, normalizedEmail } from "@/lib/email-auth";

export async function requestPasswordReset(formData: FormData) {
  const next = safeReturnPath(formData.get("next"));
  const email = normalizedEmail(formData.get("email"));
  if (!email) redirect(emailAuthPath("/forgot-password", next, { error: "Συμπλήρωσε μια έγκυρη διεύθυνση email." }));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: authCallbackUrl(authSiteOrigin(), emailAuthPath("/reset-password", next)),
  });
  if (error && error.code !== "user_not_found") redirect(emailAuthPath("/forgot-password", next, { error: "Η αποστολή email δεν είναι διαθέσιμη τώρα. Δοκίμασε ξανά αργότερα." }));
  redirect(emailAuthPath("/forgot-password", next, { sent: "1" }));
}
