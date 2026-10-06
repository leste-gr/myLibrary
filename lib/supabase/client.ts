import { createBrowserClient } from "@supabase/ssr";
import { supabaseConfig } from "@/lib/supabase/config";

export function createSupabaseBrowserClient() {
  const { url, key } = supabaseConfig();
  return createBrowserClient(url, key);
}
