import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { discoverGeminiCover, geminiConfigured } from "@/lib/gemini";
import { sameOriginRequest } from "@/lib/gemini-request";
export const runtime="nodejs";
export const maxDuration=300;
export async function POST(request:Request) {
  const json=(body:object,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
  if(!sameOriginRequest(request))return json({error:"Request not allowed."},403);
  const client=await createSupabaseServerClient();const {data:{user}}=await client.auth.getUser();
  if(!user)return json({error:"Please sign in to search for covers."},401);
  if(!geminiConfigured())return json({error:"Gemini photo import is not configured yet."},503);
  const input=z.object({importId:z.string().uuid(),action:z.enum(["status","next"])}).safeParse(await request.json().catch(()=>null));
  if(!input.success)return json({error:"Invalid import request."},400);
  const {importId,action}=input.data;
  const {data:owned}=await client.from("manual_genai_imports").select("id,collection_id").eq("id",importId).eq("owner_id",user.id).maybeSingle();
  if(!owned)return json({error:"Import not found."},404);
  const {data:collection}=await client.from("collections").select("slug").eq("id",owned.collection_id).eq("owner_id",user.id).maybeSingle();
  if(!collection)return json({error:"Import not found."},404);
  try {
    const prepared=await client.rpc("prepare_gemini_cover_jobs",{target_import_id:importId});if(prepared.error)throw new Error("Could not prepare cover searches. Please try again.");
    if(action==="next"){
      const claimed=await client.rpc("claim_gemini_cover_job",{target_import_id:importId});if(claimed.error)throw new Error("Could not start the next cover search.");
      if(claimed.data){
        const task=claimed.data;let result;
        try {result=task.book.hasCover?{coverUrl:null,notes:"An existing cover was preserved."}:await discoverGeminiCover(task.book);}
        catch{result={coverUrl:null,notes:"No suitable cover found."};}
        const finished=await client.rpc("finish_gemini_cover_job",{target_job_id:task.id,lease_token:task.lease,result});
        if(finished.error)throw new Error("Could not save cover search progress. Please resume later.");
        if(finished.data==="found"){revalidatePath("/");revalidatePath(`/collections/${collection.slug}`);revalidatePath("/radar");}
      }
    }
    const {data:jobs,error}=await client.from("gemini_cover_jobs").select("id,status,attempts,outcome,copy:copies(legacy_id,work:works(title))").eq("import_id",importId).order("id");
    if(error)throw new Error("Could not load cover search progress.");
    return json({jobs:jobs??[],collectionUrl:`/collections/${collection.slug}`});
  }catch(error){return json({error:error instanceof Error?error.message:"Cover search failed."},400);}
}
