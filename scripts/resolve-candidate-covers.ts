import { createClient } from "@supabase/supabase-js";
import { resolveCandidateCovers } from "../lib/candidate-cover-resolver";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const siteUrl = process.env.MYLIBRARY_SITE_URL?.replace(/\/$/, "");
if (!url || !key || !siteUrl) throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and MYLIBRARY_SITE_URL are required.");

const supabase = createClient(url, key, { auth: { persistSession: false } });
const results = await resolveCandidateCovers(supabase, siteUrl);
console.log(JSON.stringify({ scanned: results.length, selected: results.filter((result) => result.selected).length, unresolved: results.filter((result) => !result.selected).length }));
