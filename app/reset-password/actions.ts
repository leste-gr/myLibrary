"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeReturnPath } from "@/lib/safe-return-path";
import { emailAuthPath, passwordValidationError } from "@/lib/email-auth";

export async function setNewPassword(formData: FormData) {
  const next = safeReturnPath(formData.get("next"));
  const password = formData.get("password");
  const validation = passwordValidationError(password, formData.get("confirmPassword"));
  if (validation) redirect(emailAuthPath("/reset-password", next, { error: validation }));
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(emailAuthPath("/forgot-password", next, { error: "Ο σύνδεσμος έληξε. Ζήτησε νέο email επαναφοράς." }));
  const { error } = await supabase.auth.updateUser({ password: password as string });
  if (error) redirect(emailAuthPath("/reset-password", next, { error: "Ο κωδικός δεν άλλαξε. Χρησιμοποίησε νέο κωδικό ή ζήτησε νέο σύνδεσμο επαναφοράς." }));
  revalidatePath("/", "layout");
  redirect(emailAuthPath("/reset-password", next, { updated: "1" }));
}
