import { createClient } from "@supabase/supabase-js";
import { resolveCandidateCovers } from "../lib/candidate-cover-resolver";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const configuredSiteUrl = process.env.MYLIBRARY_SITE_URL?.replace(/\/$/, "");
if (!url || !key || !configuredSiteUrl) throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and MYLIBRARY_SITE_URL are required.");
const siteUrl = configuredSiteUrl;

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const results = await resolveCandidateCovers(supabase, siteUrl);
  console.log(JSON.stringify({ scanned: results.length, selected: results.filter((result) => result.selected).length, unresolved: results.filter((result) => !result.selected).length }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
