import type { BookPageSearchInput, VerifiedBookPage } from "./book-page-extractor";
import type { ProviderCandidate } from "./isbn-matcher";

export type ProviderLookupResult = {
  isbnCandidates: ProviderCandidate[];
  pageCandidates: VerifiedBookPage[];
  transientFailure: boolean;
};

export interface BibliographicProvider {
  readonly name: string;
  lookup(input: BookPageSearchInput): Promise<ProviderLookupResult>;
}

/** Credential-dependent providers such as Biblionet implement this boundary.
 * A web-search implementation must return verified book pages, not image-search
 * results, and must keep discovery separate from page metadata extraction. */
export type ProviderConfiguration = {
  apiBaseUrl: string;
  credentialEnvironmentVariables: string[];
};
