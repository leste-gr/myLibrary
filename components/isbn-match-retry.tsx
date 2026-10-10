"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function IsbnMatchRetry({ importId, collectionSlug }: { importId: string; collectionSlug: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/imports/${importId}/match`, { method: "POST" });
      const result = await response.json() as { matched?: number; unresolved?: number; retryable?: number; error?: string };
      if (!response.ok) throw new Error(result.error || "Η αναζήτηση ISBN απέτυχε.");
      router.replace(`/collections/${collectionSlug}?matched=${result.matched ?? 0}&unresolved=${result.unresolved ?? 0}&retryable=${result.retryable ?? 0}`);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Η αναζήτηση ISBN απέτυχε.");
      setBusy(false);
    }
  }

  return <div className="global-notice match-retry" role="status">
    <span>Η εισαγωγή ολοκληρώθηκε, αλλά η αυτόματη αναζήτηση ISBN χρειάζεται επανάληψη.</span>
    <button className="secondary-button" type="button" disabled={busy} onClick={retry}>{busy ? "Αναζήτηση ISBN…" : "Επανάληψη Stage 2"}</button>
    {error && <span className="form-error">{error}</span>}
  </div>;
}
