import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "./supabase/server";
import type { BookLoan, BookLoanChange } from "./book-loan";

// Session-scoped only: never put contact names in the public catalogue cache.
export async function getOwnedCollectionLoans(supabase: SupabaseClient, collectionId: string): Promise<Record<string,BookLoan>> {
  const entries: [string,BookLoan][] = [];
  for (let offset=0;;offset+=500) {
    const { data,error } = await supabase.from("book_loans").select("status,person_name,copy:copies!inner(legacy_id)")
      .eq("collection_id",collectionId).order("copy_id").range(offset,offset+499);
    if (error) throw new Error("Unable to load book loans.");
    for (const row of data ?? []) {
      const copy = Array.isArray(row.copy) ? row.copy[0] : row.copy;
      if (copy && (row.status === "loaned_out" || row.status === "loaned_in")) entries.push([copy.legacy_id,{ status: row.status,personName: row.person_name }]);
    }
    if ((data?.length ?? 0)<500) return Object.fromEntries(entries);
  }
}

export async function changeBookLoan(input: BookLoanChange) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Please sign in to change loan details." };
    const { data: collection,error: collectionError } = await supabase.from("collections").select("id,slug")
      .eq("slug",input.slug).eq("owner_id",user.id).maybeSingle();
    if (collectionError || !collection) throw new Error("Collection ownership required.");
    const { error } = await supabase.rpc("set_owned_book_loan",{
      target_collection_id: collection.id,target_legacy_id: input.legacyId,new_status: input.status,contact_name: input.personName,
    });
    if (error) throw error;
    revalidatePath(`/collections/${collection.slug}`);
    return { success: true };
  } catch {
    return { error: "Could not save loan details. Please try again." };
  }
}
