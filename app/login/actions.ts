"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect("/login?error=" + encodeURIComponent(error.message));
  const { data: collection } = await supabase.from("collections").select("slug").eq("owner_id", data.user.id).order("created_at", { ascending: true }).limit(1).maybeSingle();
  redirect(collection ? `/collections/${collection.slug}` : "/");
}
