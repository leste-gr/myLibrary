import asyncio
import re
import unicodedata
from difflib import SequenceMatcher
from typing import Any

import httpx

from .isbn import canonical_isbn


def normalize(value: str | None) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    return re.sub(r"[^a-z0-9]+", " ", text.encode("ascii", "ignore").decode().lower()).strip()


def similarity(left: str | None, right: str | None) -> float:
    return SequenceMatcher(None, normalize(left), normalize(right)).ratio()


def candidate_score(title: str, author: str, candidate: dict[str, Any]) -> tuple[int, dict[str, int]]:
    title_score = round(similarity(title, candidate.get("title")) * 300)
    author_score = round(similarity(author, candidate.get("author")) * 200) if author else 0
    provider_score = 30
    breakdown = {"title_similarity": title_score, "author_similarity": author_score, "provider_result": provider_score}
    return sum(breakdown.values()), breakdown


async def _open_library(client: httpx.AsyncClient, title: str, author: str) -> list[dict[str, Any]]:
    response = await client.get("https://openlibrary.org/search.json", params={"title": title, "author": author, "limit": 5, "fields": "key,title,author_name,isbn,publisher,first_publish_year"})
    response.raise_for_status()
    results = []
    for item in response.json().get("docs", []):
        for raw_isbn in item.get("isbn", [])[:8]:
            isbn = canonical_isbn(raw_isbn)
            if isbn:
                results.append({"isbn13": isbn, "title": item.get("title"), "author": ", ".join(item.get("author_name", [])), "publishers": item.get("publisher", [])[:5], "published_date": str(item.get("first_publish_year") or "") or None, "provider": "openlibrary", "provider_id": f"{item.get('key')}:{isbn}"})
    return results


async def _google_books(client: httpx.AsyncClient, title: str, author: str) -> list[dict[str, Any]]:
    query = f'intitle:"{title}"' + (f'+inauthor:"{author}"' if author else "")
    response = await client.get("https://www.googleapis.com/books/v1/volumes", params={"q": query, "maxResults": 5, "printType": "books"})
    response.raise_for_status()
    results = []
    for item in response.json().get("items", []):
        info = item.get("volumeInfo", {})
        isbn = next((canonical_isbn(identifier.get("identifier")) for identifier in info.get("industryIdentifiers", []) if canonical_isbn(identifier.get("identifier"))), None)
        if isbn:
            results.append({"isbn13": isbn, "title": info.get("title"), "author": ", ".join(info.get("authors", [])), "publishers": [info["publisher"]] if info.get("publisher") else [], "published_date": info.get("publishedDate"), "provider": "google-books", "provider_id": item.get("id")})
    return results


async def find_candidates(title: str, author: str) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=15, headers={"User-Agent": "myLibrary/0.3"}) as client:
        responses = await asyncio.gather(_open_library(client, title, author), _google_books(client, title, author), return_exceptions=True)
    merged: dict[str, dict[str, Any]] = {}
    for response in responses:
        if isinstance(response, Exception):
            continue
        for candidate in response:
            score, breakdown = candidate_score(title, author, candidate)
            existing = merged.get(candidate["isbn13"])
            if not existing or score > existing["score"]:
                candidate.update(score=score, score_breakdown=breakdown, provider_count=1)
                merged[candidate["isbn13"]] = candidate
            elif existing:
                existing["provider_count"] += 1
                existing["score"] += 50
                existing["score_breakdown"]["provider_agreement"] = 50
    return sorted(merged.values(), key=lambda item: (-item["score"], item["isbn13"]))[:10]
