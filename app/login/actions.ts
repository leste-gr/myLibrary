"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeReturnPath } from "@/lib/safe-return-path";

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeReturnPath(formData.get("next"));
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect("/login?error=" + encodeURIComponent(error.message) + (next ? "&next=" + encodeURIComponent(next) : ""));
  if (next) redirect(next);
  const { data: collection } = await supabase.from("collections").select("slug").eq("owner_id", data.user.id).order("created_at", { ascending: true }).limit(1).maybeSingle();
  redirect(collection ? `/collections/${collection.slug}` : "/");
}
