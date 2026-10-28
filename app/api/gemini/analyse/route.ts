import { createSupabaseServerClient } from "@/lib/supabase/server";
import { analyseShelfPhotos, geminiConfigured, MAX_SHELFIE_BYTES } from "@/lib/gemini";
import { sameOriginRequest } from "@/lib/gemini-request";
export const runtime="nodejs";
export const maxDuration=120;
export async function POST(request:Request) {
  const json=(body:object,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
  if(!sameOriginRequest(request))return json({error:"Request not allowed."},403);
  const client=await createSupabaseServerClient();
  const {data:{user}}=await client.auth.getUser();
  if(!user)return json({error:"Please sign in to import shelf photos."},401);
  if(!geminiConfigured())return json({error:"Gemini photo import is not configured yet."},503);
  if(Number(request.headers.get("content-length")??0)>MAX_SHELFIE_BYTES+100_000)return json({error:"Choose up to 3 photos, no more than 3 MB in total."},413);
  try {
    const form=await request.formData();
    if(form.get("consent")!=="yes")return json({error:"Confirm that these photos may be sent to Google Gemini."},400);
    const files=form.getAll("photos");
    if(files.some(file=>!(file instanceof File)))return json({error:"Choose JPG, PNG or WebP shelf photos."},400);
    return json({payload:await analyseShelfPhotos(files as File[])});
  }catch(error){return json({error:error instanceof Error&& !error.message.includes("{")?error.message:"Could not read the books. Please try another photo."},400);}
}
