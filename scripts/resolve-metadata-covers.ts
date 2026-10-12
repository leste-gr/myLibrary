import { createClient } from "@supabase/supabase-js";
import { mapWithConcurrency } from "../lib/isbn-matcher";
import { resolveMetadataCover, type MetadataCoverInput } from "../lib/metadata-cover-resolver";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
const supabase = createClient(url, key, { auth: { persistSession: false } });
async function main() {
  const { data, error } = await supabase.from("copies").select("id,publisher,language,cover_url,edition_verification_state,work:works(title,author)").or("cover_url.is.null,cover_source.eq.metadata-resolver").eq("edition_verification_state", "unresolved").order("created_at");
  if (error) throw new Error(error.message);
  const inputs: MetadataCoverInput[] = (data ?? []).flatMap((copy) => { const work = Array.isArray(copy.work) ? copy.work[0] : copy.work; return work?.title ? [{ copyId: copy.id, title: work.title, authors: String(work.author ?? "").split(",").map((v) => v.trim()).filter(Boolean), publisher: copy.publisher, language: copy.language }] : []; });
  let resolved = 0;
  await mapWithConcurrency(inputs, 2, async (input) => { if (await resolveMetadataCover(supabase, input)) resolved++; });
  console.log(JSON.stringify({ scanned: inputs.length, resolved, unresolved: inputs.length - resolved }));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });

