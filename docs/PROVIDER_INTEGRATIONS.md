# Provider integration plan

This document tracks metadata providers beyond the reviewed local catalogue, Open Library, and Google Books. A provider is not considered active until credentials, request limits, licensing, failure semantics, and a representative benchmark have been verified.

## Verified book-page discovery

The legacy deterministic resolver searches for book pages rather than images. The intended query sequence is:

1. `"title" ISBN`
2. `"title" "author" "publisher"`
3. `"title" "author" εξώφυλλο`
4. `"series" "volume" "publisher"`

`lib/book-page-extractor.ts` implements query construction, generic Schema.org `Book`/`Product` extraction, Open Graph fallback, and verification. A discovered page is accepted only when its title strongly matches and author or publisher evidence corroborates it. Conflicting authors are rejected. ISBN, image, and metadata are extracted from the same verified page; an image-search result by itself is never sufficient evidence.

Discovery is active through DuckDuckGo's HTML results and Bing's RSS output, both of which supply page links rather than image results. Multiple indexes are used because Greek-title coverage varies substantially. Result pages pass strict URL validation, private-address blocking, redirect checks, response-size limits, and timeouts before generic extraction. Search failure is treated as an unavailable optional provider, not as proof that a cover does not exist. A supported credentialed search API can replace the discovery adapters later without changing page verification or cover selection.

Start with the generic extractor. Add site-specific adapters only after benchmark evidence shows a domain repeatedly resolves books and its terms permit automated access.

## Greek providers

### Biblionet

Biblionet is the first credential-dependent provider to evaluate because its documented data includes ISBN, title, publisher, author, publication dates, and `CoverImage`. Access requires Biblionet approval and credentials. No production request is implemented until the approved API base URL, authentication method, usage terms, and cover-storage policy are supplied and verified.

The adapter will implement `BibliographicProvider` from `lib/bibliographic-provider.ts` and preserve the Biblionet record ID, ISBN, cover identifier/URL, and raw provider response. Required configuration names will be finalized from Biblionet's approved onboarding documentation rather than guessed.

### BookPoint

BookPoint supports user-facing searches by title, ISBN, author, and publisher and may be valuable for Greek-market editions. No supported public API has been verified. Pursue a data partnership or documented integration; do not build a production scraper without permission.

## Other providers

- **Crossref REST API:** next free metadata experiment for publisher-registered books. It is not expected to solve all trade or older Greek editions.
- **Library of Congress SRU:** useful secondary source for English-language and older catalogued editions.
- **ISBNdb:** optional paid comparison if free-provider recall remains inadequate.
- **WorldCat Search API:** defer unless eligible OCLC credentials and terms are available.

## Edition-specific identifiers

Every candidate now keeps structured provider identifiers separately from the display/provider string:

- Open Library work OLID;
- Open Library edition OLIDs, including the cover edition when supplied;
- Open Library cover ID;
- Google Books volume ID;
- provider identifiers supplied by external catalogue APIs.

These identifiers allow future cover resolution to use an edition OLID or cover ID instead of combining a work-level cover with an arbitrary ISBN. Open Library ISBN requests already use `default=false`; cover-ID/OLID routing is the next provider-specific resolver improvement and also avoids the ISBN-cover-specific request limit.

## Benchmark

Use the owner's 160-book collection as the first labelled corpus. For every book, record:

- correct work;
- correct physical edition, if identifiable;
- acceptable representative cover, if exact edition is unknown;
- rejected candidates and reason;
- language, publisher, series/volume, magazine issue, or RPG product code when applicable.

Compare these strategies independently:

1. current ISBN providers and reviewed local knowledge;
2. edition-specific Open Library/Google identifiers;
3. Biblionet;
4. verified web page discovery;
5. visual checks for the remaining ambiguous cases.

Measure correct-cover rate, wrong-cover rate, exact-edition rate, representative-cover rate, provider failure rate, elapsed time, and cost per resolved book. Do not optimize only for the number of images found: wrong-cover rate is the primary safety metric.

## Photo-import cover discovery

Photo imports use Gemini only to identify books in photographs. Cover discovery
uses Serper Google Images (`POST https://google.serper.dev/images`) and takes
only the first returned image. Configure server-only `SERPER_API_KEY` in Vercel
Production. Queries use title and author, omit unknown-author placeholders, and
respect the book language for localization.

The first result's original image URL is validated, safely downloaded and decoded
before saving. It is not visually matched to the book. An invalid, unavailable or
unreadable first result returns `No suitable cover found.` without choosing the
next result. There is no Gemini call, catalogue fallback or provider retry.
Existing covers are preserved. New assets record provider `serper` and verification
status `provisional`, not model verification. The API key stays server-side.
