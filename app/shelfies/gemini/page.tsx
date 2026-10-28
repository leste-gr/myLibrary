import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTranslations } from "@/lib/i18n/server";
import { geminiConfigured } from "@/lib/gemini";
import { GeminiShelfieImport } from "@/components/gemini-shelfie-import";
export const dynamic="force-dynamic";
export default async function GeminiImportPage({searchParams}:{searchParams:Promise<{collection?:string}>}) {
  const client=await createSupabaseServerClient();const {data:{user}}=await client.auth.getUser();
  if(!user)redirect("/login?next=%2Fshelfies%2Fgemini");
  const t=await getTranslations();const {collection:slug}=await searchParams;
  const {data,error}=await client.from("collections").select("id,slug,name").eq("owner_id",user.id).order("created_at");
  if(error)throw new Error("Could not load your collections.");
  const collections=[...(data??[])].sort((a,b)=>Number(b.slug===slug)-Number(a.slug===slug));
  return <main className="shelfie-shell"><Link href="/shelfies">{t("← Back")}</Link><h1>{t("Import photos with Gemini")}</h1>
    <p className="shelfie-lead">{t("Upload shelf photos, review the books, and add them to a new or existing collection.")}</p>
    <GeminiShelfieImport userId={user.id} collections={collections} configured={geminiConfigured()}/>
  </main>;
}
