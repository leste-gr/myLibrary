import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTranslations } from "@/lib/i18n/server";
import { GeminiCoverProgress } from "@/components/gemini-cover-progress";
export const dynamic="force-dynamic";
export default async function GeminiCoversPage({searchParams}:{searchParams:Promise<{importId?:string}>}) {
  const {importId}=await searchParams;if(!z.string().uuid().safeParse(importId).success)notFound();
  const client=await createSupabaseServerClient();const {data:{user}}=await client.auth.getUser();
  if(!user)redirect("/login?next="+encodeURIComponent(`/shelfies/gemini/covers?importId=${importId}`));
  const {data:record}=await client.from("manual_genai_imports").select("id,collection_id").eq("id",importId!).eq("owner_id",user.id).maybeSingle();
  if(!record)notFound();
  const {data:collection}=await client.from("collections").select("slug").eq("id",record.collection_id).eq("owner_id",user.id).maybeSingle();
  if(!collection)notFound();const t=await getTranslations();
  return <main className="shelfie-shell"><Link href="/shelfies/gemini">{t("← Back")}</Link><h1>{t("Finding your book covers")}</h1><GeminiCoverProgress importId={importId!} collectionUrl={`/collections/${collection.slug}`}/></main>;
}
