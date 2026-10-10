import { createClient } from "@supabase/supabase-js";
import { processManualGenaiImport } from "../lib/process-manual-import";

async function main() {
  const importId = process.argv[2];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!importId) throw new Error("Usage: npm run match:import -- <manual-import-id>");
  if (!url || !serviceRoleKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await processManualGenaiImport(supabase, importId);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

void main();
