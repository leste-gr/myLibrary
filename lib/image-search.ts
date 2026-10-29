import { publicCoverUrlSchema } from "./update-covers";

export type CoverImageCandidate = {url:string;source:string;label:string};

/** Original image URLs from Google Images via Serper; no HTML scraping or retries. */
export async function searchCoverImages(query:string, language:string, signal?:AbortSignal, fetcher:typeof fetch=fetch):Promise<CoverImageCandidate[]> {
  const key=process.env.SERPER_API_KEY;
  if(!key) throw new Error("Image search is not configured.");
  const greek=/^(el|gr|greek|ελλην)/i.test(language)||/[\u0370-\u03ff\u1f00-\u1fff]/.test(query);
  const response=await fetcher("https://google.serper.dev/images",{
    method:"POST",cache:"no-store",redirect:"error",
    headers:{"Content-Type":"application/json","X-API-KEY":key},
    signal:AbortSignal.any([AbortSignal.timeout(12_000),...(signal?[signal]:[])]),
    body:JSON.stringify({q:query,gl:greek?"gr":"us",hl:greek?"el":"en",num:10}),
  });
  if(!response.ok) throw new Error("No suitable cover found.");
  const result=await response.json();
  if(!Array.isArray(result.images)) return [];
  const seen=new Set<string>();
  return result.images.flatMap((item:Record<string,unknown>)=>{
    if(!item||!publicCoverUrlSchema.safeParse(item.imageUrl).success||!publicCoverUrlSchema.safeParse(item.link).success||seen.has(String(item.imageUrl)))return [];
    const url=String(item.imageUrl);seen.add(url);
    return [{url,source:String(item.link),label:typeof item.title==="string"?item.title.slice(0,300):"Book cover"}];
  }).slice(0,10);
}
