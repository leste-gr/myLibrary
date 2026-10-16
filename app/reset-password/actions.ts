"use server";
import { getTranslations } from "@/lib/i18n/server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeReturnPath } from "@/lib/safe-return-path";
import { emailAuthPath, passwordValidationError } from "@/lib/email-auth";

export async function setNewPassword(formData: FormData) {
  const t = await getTranslations();
  const next = safeReturnPath(formData.get("next"));
  const password = formData.get("password");
  const validation = passwordValidationError(password, formData.get("confirmPassword"));
  if (validation) redirect(emailAuthPath("/reset-password", next, { error: t(validation) }));
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(emailAuthPath("/forgot-password", next, { error: t("This link has expired. Request a new password reset email.") }));
  const { error } = await supabase.auth.updateUser({ password: password as string });
  if (error) redirect(emailAuthPath("/reset-password", next, { error: t("Your password was not changed. Use a new password or request another reset link.") }));
  revalidatePath("/", "layout");
  redirect(emailAuthPath("/reset-password", next, { updated: "1" }));
}
