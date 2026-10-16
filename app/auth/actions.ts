"use server";
import { getTranslations } from "@/lib/i18n/server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function signOut() {
  const t = await getTranslations();
  const supabase = await createSupabaseServerClient();
  // Website logout ends this browser session. Plugin grants have their own revoke action.
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw new Error(t("Could not log out. Please try again."));
  revalidatePath("/", "layout");
  redirect("/");
}
