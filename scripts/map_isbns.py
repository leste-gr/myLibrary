#!/usr/bin/env python3
"""Build a reviewable ISBN mapping from catalogue metadata and provenance.

The script never writes ISBNs into books.json. It records candidates and accepts
an ISBN automatically only when the existing edition-level provenance provides
one unambiguous, valid ISBN. Run from the repository root.
"""

from __future__ import annotations

import argparse
import json
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BOOKS_PATH = ROOT / "books.json"
SOURCES_PATH = ROOT / "cover-sources.json"
OUTPUT_PATH = ROOT / "data" / "isbn-mapping.json"
PUBLIC_OUTPUT_PATH = ROOT / "isbn.json"
USER_AGENT = "myLibrary-isbn-mapper/0.1 (+https://github.com/leste-gr/myLibrary)"
ISBN_RE = re.compile(r"(?<!\d)(?:97[89][\s-]?)?(?:\d[\s-]?){8,11}[\dXx](?!\d)")


def isbn10_valid(value: str) -> bool:
    return len(value) == 10 and all(c.isdigit() for c in value[:9]) and (
        value[-1].isdigit() or value[-1] == "X"
    ) and sum((10 - i) * (10 if c == "X" else int(c)) for i, c in enumerate(value)) % 11 == 0


def isbn13_valid(value: str) -> bool:
    return len(value) == 13 and value.isdigit() and value[:3] in {"978", "979"} and (
        sum((1 if i % 2 == 0 else 3) * int(c) for i, c in enumerate(value[:12]))
        + int(value[-1])
    ) % 10 == 0


def normalize_isbn(value: object) -> str | None:
    cleaned = re.sub(r"[^0-9X]", "", str(value).upper())
    if isbn13_valid(cleaned) or isbn10_valid(cleaned):
        return cleaned
    return None


def isbn10_to_13(value: str) -> str | None:
    value = normalize_isbn(value) or ""
    if len(value) != 10:
        return None
    body = "978" + value[:9]
    check = (10 - sum((1 if i % 2 == 0 else 3) * int(c) for i, c in enumerate(body)) % 10) % 10
    return body + str(check)


def canonical_isbn(value: object) -> str | None:
    normalized = normalize_isbn(value)
    if not normalized:
        return None
    return isbn10_to_13(normalized) if len(normalized) == 10 else normalized


def text_key(value: object) -> str:
    value = unicodedata.normalize("NFKD", str(value or "")).casefold()
    return " ".join(re.sub(r"[^\w]+", " ", value).split())


def get_json(url: str) -> object:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def get_text(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode(response.headers.get_content_charset() or "utf-8", errors="replace")


def cover_id(source: dict) -> int | None:
    match = re.search(r"/b/id/(\d+)-", source.get("imageUrl", ""))
    return int(match.group(1)) if match else None


def candidate(isbn: object, provider: str, provider_id: str, evidence: list[str], **metadata: object) -> dict | None:
    isbn13 = canonical_isbn(isbn)
    if not isbn13:
        return None
    result = {"isbn13": isbn13, "provider": provider, "providerId": provider_id, "evidence": evidence}
    result.update({key: value for key, value in metadata.items() if value not in (None, "", [])})
    return result


def openlibrary_candidates(book: dict, source: dict) -> list[dict]:
    source_url = source.get("sourceUrl", "")
    book_match = re.search(r"openlibrary\.org/books/(OL\d+M)", source_url)
    work_match = re.search(r"openlibrary\.org/works/(OL\d+W)", source_url)
    records: list[dict] = []
    if book_match:
        edition_id = book_match.group(1)
        edition = get_json(f"https://openlibrary.org/books/{edition_id}.json")
        for raw_isbn in edition.get("isbn_13", []) + edition.get("isbn_10", []):
            item = candidate(
                raw_isbn,
                "openlibrary",
                edition_id,
                ["existing edition-level source"],
                title=edition.get("title"),
                publishers=edition.get("publishers"),
                publishDate=edition.get("publish_date"),
                coverIds=edition.get("covers"),
            )
            if item:
                records.append(item)
        return records
    if not work_match:
        return records

    work_id = work_match.group(1)
    payload = get_json(f"https://openlibrary.org/works/{work_id}/editions.json?limit=1000")
    selected_cover = cover_id(source)
    for edition in payload.get("entries", []):
        evidence = ["existing work-level source"]
        edition_covers = edition.get("covers", [])
        if selected_cover and selected_cover in edition_covers:
            evidence.append("selected cover ID matches edition")
        for raw_isbn in edition.get("isbn_13", []) + edition.get("isbn_10", []):
            item = candidate(
                raw_isbn,
                "openlibrary",
                edition.get("key", "").rsplit("/", 1)[-1],
                evidence,
                title=edition.get("title"),
                publishers=edition.get("publishers"),
                publishDate=edition.get("publish_date"),
                coverIds=edition_covers,
            )
            if item:
                records.append(item)
    return records


def page_candidates(source_url: str) -> list[dict]:
    html = get_text(source_url)
    structured = re.findall(
        r'<meta[^>]+(?:property|name)=["\'](?:og:books:isbn|books:isbn|isbn)["\'][^>]+content=["\']([^"\']+)',
        html,
        flags=re.IGNORECASE,
    )
    structured += re.findall(
        r'["\']isbn(?:10|13)?["\']\s*:\s*["\']([^"\']+)',
        html,
        flags=re.IGNORECASE,
    )
    matches = structured or ISBN_RE.findall(html)
    records = []
    for match in matches:
        evidence = ["structured ISBN on existing source page"] if structured else ["ISBN text on existing source page"]
        item = candidate(match, urllib.parse.urlsplit(source_url).hostname or "source-page", source_url, evidence)
        if item:
            records.append(item)
    return records


def google_candidates(book: dict) -> list[dict]:
    terms = [f'intitle:"{book["title"]}"']
    if book.get("author") and book["author"] not in {"Μη αναγνωσμένος", "Συλλογικό έργο"}:
        terms.append(f'inauthor:"{book["author"]}"')
    url = "https://www.googleapis.com/books/v1/volumes?" + urllib.parse.urlencode(
        {"q": " ".join(terms), "maxResults": 20, "printType": "books"}
    )
    payload = get_json(url)
    records = []
    for item in payload.get("items", []):
        info = item.get("volumeInfo", {})
        title_match = text_key(book["title"]) == text_key(info.get("title"))
        author_match = text_key(book.get("author")) in {text_key(value) for value in info.get("authors", [])}
        evidence = [name for matched, name in ((title_match, "exact normalized title"), (author_match, "exact normalized author")) if matched]
        for identifier in info.get("industryIdentifiers", []):
            result = candidate(
                identifier.get("identifier"),
                "google-books",
                item.get("id", ""),
                evidence,
                title=info.get("title"),
                authors=info.get("authors"),
                publisher=info.get("publisher"),
                publishDate=info.get("publishedDate"),
            )
            if result:
                records.append(result)
    return records


def openlibrary_search_candidates(book: dict) -> list[dict]:
    query = {"title": book["title"], "limit": 20, "fields": "key,title,author_name,isbn,publisher,first_publish_year"}
    if book.get("author") and book["author"] not in {"Μη αναγνωσμένος", "Συλλογικό έργο"}:
        query["author"] = book["author"]
    payload = get_json("https://openlibrary.org/search.json?" + urllib.parse.urlencode(query))
    records = []
    for result in payload.get("docs", []):
        for raw_isbn in result.get("isbn", []):
            item = candidate(
                raw_isbn,
                "openlibrary-search",
                result.get("key", "").rsplit("/", 1)[-1],
                ["title and author search candidate"],
                title=result.get("title"),
                authors=result.get("author_name"),
                publishers=result.get("publisher"),
                publishDate=result.get("first_publish_year"),
            )
            if item:
                records.append(item)
    return records


def deduplicate(records: list[dict]) -> list[dict]:
    unique: dict[tuple[str, str, str], dict] = {}
    for item in records:
        key = (item["isbn13"], item["provider"], item["providerId"])
        unique[key] = item
    return sorted(unique.values(), key=lambda item: (item["isbn13"], item["provider"], item["providerId"]))


def rank_candidates(book: dict, records: list[dict], limit: int = 10) -> list[dict]:
    ranked = []
    book_title = text_key(book.get("title"))
    book_publisher = text_key(book.get("publisher"))
    for item in records:
        score = 0
        if "selected cover ID matches edition" in item["evidence"]:
            score += 100
        if book_title and book_title == text_key(item.get("title")):
            score += 25
        candidate_publishers = item.get("publishers") or [item.get("publisher")]
        if book_publisher and book_publisher in {text_key(value) for value in candidate_publishers if value}:
            score += 20
        item["score"] = score
        ranked.append(item)
    ranked.sort(key=lambda item: (-item["score"], item["isbn13"], item["provider"], item["providerId"]))
    unique = []
    seen_isbns = set()
    for item in ranked:
        if item["isbn13"] in seen_isbns:
            continue
        seen_isbns.add(item["isbn13"])
        unique.append(item)
        if len(unique) == limit:
            break
    return unique


def select_exact(records: list[dict]) -> tuple[str | None, str]:
    exact = {
        item["isbn13"]
        for item in records
        if "existing edition-level source" in item["evidence"]
        or "structured ISBN on existing source page" in item["evidence"]
    }
    if len(exact) == 1:
        return exact.pop(), "accepted"
    if len(exact) > 1:
        return None, "needs_review"
    return None, "needs_review" if records else "unresolved"


def initial_entry(book: dict, source: dict | None) -> dict:
    return {
        "copyId": book["id"],
        "title": book["title"],
        "author": book["author"],
        "publisher": book.get("publisher"),
        "sourceUrl": (source or {}).get("sourceUrl") or book.get("coverSource"),
        "isbn13": None,
        "suggestedIsbn13": None,
        "suggestionBasis": None,
        "status": "pending",
        "confidence": None,
        "candidates": [],
        "notes": [],
    }


def map_entry(entry: dict, book: dict, source: dict | None, use_google_books: bool = False) -> dict:
    entry["notes"] = []
    records: list[dict] = []
    source_url = (source or {}).get("sourceUrl") or book.get("coverSource") or ""
    try:
        if "openlibrary.org/" in source_url:
            records.extend(openlibrary_candidates(book, source or {"sourceUrl": source_url}))
        elif source_url.startswith("http"):
            records.extend(page_candidates(source_url))
    except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as error:
        entry["notes"].append(f"source lookup failed: {type(error).__name__}")
    if not records:
        try:
            records.extend(openlibrary_search_candidates(book))
        except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as error:
            entry["notes"].append(f"Open Library search failed: {type(error).__name__}")
    if use_google_books:
        try:
            records.extend(google_candidates(book))
        except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as error:
            entry["notes"].append(f"Google Books lookup failed: {type(error).__name__}")
    records = deduplicate(records)
    selected, status = select_exact(records)
    cover_isbns = {
        item["isbn13"] for item in records if "selected cover ID matches edition" in item["evidence"]
    }
    suggestion = selected or (next(iter(cover_isbns)) if len(cover_isbns) == 1 else None)
    basis = "exact_provenance" if selected else ("selected_cover" if suggestion else None)
    entry.update(
        {
            "isbn13": selected,
            "suggestedIsbn13": suggestion,
            "suggestionBasis": basis,
            "status": status,
            "confidence": "exact_provenance" if selected else None,
            "candidates": rank_candidates(book, records),
        }
    )
    return entry


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--init-only", action="store_true", help="Create the review file without network lookups")
    parser.add_argument("--copy-id", action="append", help="Only process a copy ID; may be repeated")
    parser.add_argument("--delay", type=float, default=0.15, help="Delay between records in seconds")
    parser.add_argument("--google-books", action="store_true", help="Also query Google Books (requires available API quota)")
    args = parser.parse_args()

    books = json.loads(BOOKS_PATH.read_text(encoding="utf-8"))
    sources = json.loads(SOURCES_PATH.read_text(encoding="utf-8"))
    existing = {}
    if OUTPUT_PATH.exists():
        existing = {item["copyId"]: item for item in json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))["books"]}

    selected_ids = set(args.copy_id or [])
    output = []
    for book in books:
        entry = existing.get(book["id"], initial_entry(book, sources.get(book["id"])))
        if not args.init_only and (not selected_ids or book["id"] in selected_ids):
            entry = map_entry(entry, book, sources.get(book["id"]), use_google_books=args.google_books)
            time.sleep(args.delay)
        output.append(entry)

    payload = {
        "schemaVersion": 1,
        "assumption": "Each unique valid ISBN-13 identifies one cover edition for myLibrary.",
        "policy": "Only exact edition-level provenance is accepted automatically; all other candidates require review.",
        "books": output,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    public_isbns = {item["copyId"]: item["isbn13"] for item in output if item["status"] == "accepted"}
    PUBLIC_OUTPUT_PATH.write_text(json.dumps(public_isbns, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    counts: dict[str, int] = {}
    for item in output:
        counts[item["status"]] = counts.get(item["status"], 0) + 1
    print(json.dumps({"total": len(output), "status": counts}, ensure_ascii=False))


if __name__ == "__main__":
    main()
