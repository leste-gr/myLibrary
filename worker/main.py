import asyncio
import hashlib
import logging
import os
import socket
import time
from datetime import UTC, datetime
from typing import Any

from supabase import Client, create_client

from .isbn import canonical_isbn
from .providers import find_candidates
from .recognition import DetectedBook, recognize_books


logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
LOG = logging.getLogger("shelfie-worker")
POLL_SECONDS = int(os.getenv("POLL_SECONDS", "10"))
MAX_ATTEMPTS = int(os.getenv("MAX_ATTEMPTS", "3"))
MODEL = os.getenv("OPENAI_VISION_MODEL", "gpt-4.1-mini")
WORKER_NAME = os.getenv("WORKER_NAME", socket.gethostname())


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def database() -> Client:
    required("OPENAI_API_KEY")
    return create_client(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"))


def claim_next(client: Client) -> dict[str, Any] | None:
    rows = client.rpc("claim_next_shelfie", {"worker_name": WORKER_NAME}).execute().data or []
    return rows[0] if rows else None


def next_display_order(client: Client, collection_id: str) -> int:
    rows = client.table("copies").select("display_order").eq("collection_id", collection_id).order("display_order", desc=True).limit(1).execute().data
    return int(rows[0]["display_order"]) + 1 if rows else 1


def ensure_copy(client: Client, job: dict[str, Any], book: DetectedBook, index: int, display_order: int) -> str:
    external_key = f"shelfie:{job['id']}:{index}"
    work = client.table("works").upsert({
        "external_key": external_key,
        "title": book.title or "Άγνωστος τίτλος",
        "author": book.author or "Άγνωστος συγγραφέας",
        "normalized_title": book.title.casefold().strip(),
        "normalized_author": book.author.casefold().strip(),
    }, on_conflict="external_key").execute().data[0]
    legacy_id = f"S-{job['id'][:8].upper()}-{index + 1:03d}"
    existing = client.table("copies").select("id").eq("collection_id", job["collection_id"]).eq("legacy_id", legacy_id).limit(1).execute().data
    if existing:
        return existing[0]["id"]
    created = client.table("copies").insert({
        "collection_id": job["collection_id"],
        "legacy_id": legacy_id,
        "work_id": work["id"],
        "display_order": display_order,
        "category": "Αταξινόμητα",
        "language": book.language or "Άγνωστη",
        "publisher": book.publisher,
        "published": True,
        "edition_verification_state": "unresolved",
    }).execute().data[0]
    return created["id"]


def save_observation(client: Client, job: dict[str, Any], copy_id: str, book: DetectedBook, index: int) -> None:
    existing = client.table("book_observations").select("id").eq("shelfie_upload_id", job["id"]).eq("detection_index", index).limit(1).execute().data
    payload = {
        "collection_id": job["collection_id"],
        "copy_id": copy_id,
        "shelfie_upload_id": job["id"],
        "detection_index": index,
        "source_type": "shelfie",
        "source_asset_url": None,
        "title_text": book.title or None,
        "author_text": book.author or None,
        "publisher_text": book.publisher,
        "isbn_text": book.isbn,
        "language_hint": book.language,
        "raw_payload": {"detection_index": index, "recognition_model": MODEL},
        "confidence": max(0, min(1, book.confidence)),
        "status": "ready_for_matching",
    }
    if existing:
        client.table("book_observations").update(payload).eq("id", existing[0]["id"]).execute()
    else:
        client.table("book_observations").insert(payload).execute()


async def save_candidates(client: Client, copy_id: str, book: DetectedBook) -> None:
    candidates = await find_candidates(book.title, book.author)
    visible_isbn = canonical_isbn(book.isbn)
    if visible_isbn:
        candidates = [item for item in candidates if item["isbn13"] != visible_isbn]
        candidates.insert(0, {
            "isbn13": visible_isbn,
            "title": book.title,
            "author": book.author,
            "publishers": [book.publisher] if book.publisher else [],
            "published_date": None,
            "provider": "shelfie-visible-isbn",
            "provider_id": f"visible:{visible_isbn}",
            "score": 1200,
            "score_breakdown": {"visible_valid_isbn": 1200},
            "provider_count": 1,
        })
    for rank, candidate in enumerate(candidates, start=1):
        score = candidate["score"]
        client.table("edition_candidates").upsert({
            "copy_id": copy_id,
            "isbn13": candidate["isbn13"],
            "title": candidate.get("title") or book.title,
            "publishers": candidate.get("publishers") or [],
            "published_date": candidate.get("published_date"),
            "cover_url": f"/api/covers/{candidate['isbn13']}",
            "provider": candidate["provider"],
            "provider_id": candidate["provider_id"],
            "score": score,
            "suggested": rank == 1,
            "rank": rank,
            "evidence": list(candidate["score_breakdown"].keys()),
            "selection_state": "alternative",
            "confidence": min(1, score / 1200),
            "algorithm_version": "shelfie-ranker-v1",
            "score_breakdown": candidate["score_breakdown"],
            "provider_count": candidate["provider_count"],
        }, on_conflict="copy_id,isbn13").execute()


def delete_source(client: Client, job: dict[str, Any]) -> None:
    if job.get("storage_path"):
        client.storage.from_("shelfies").remove([job["storage_path"]])


async def process(client: Client, job: dict[str, Any]) -> None:
    path = job.get("storage_path")
    if not path:
        raise RuntimeError("Shelfie has no storage path")
    image = client.storage.from_("shelfies").download(path)
    checksum = hashlib.sha256(image).hexdigest()
    client.table("shelfie_uploads").update({"content_checksum": checksum, "heartbeat_at": now_iso()}).eq("id", job["id"]).execute()
    books = recognize_books(image, job["content_type"], MODEL)
    if not books:
        raise RuntimeError("No readable book spines were detected")

    display_order = next_display_order(client, job["collection_id"])
    for index, book in enumerate(books):
        copy_id = ensure_copy(client, job, book, index, display_order + index)
        save_observation(client, job, copy_id, book, index)
        await save_candidates(client, copy_id, book)
        client.table("shelfie_uploads").update({"heartbeat_at": now_iso()}).eq("id", job["id"]).execute()

    delete_source(client, job)
    client.table("shelfie_uploads").update({
        "status": "completed",
        "storage_path": None,
        "asset_deleted_at": now_iso(),
        "completed_at": now_iso(),
        "detected_book_count": len(books),
        "claimed_by": None,
        "heartbeat_at": None,
        "processing_error": None,
    }).eq("id", job["id"]).execute()
    LOG.info("completed shelfie=%s books=%d", job["id"], len(books))


async def handle_failure(client: Client, job: dict[str, Any], error: Exception) -> None:
    message = f"{type(error).__name__}: {error}"
    LOG.exception("failed shelfie=%s attempt=%s", job["id"], job["attempt_count"])
    if int(job["attempt_count"]) < MAX_ATTEMPTS:
        delay = min(1800, 60 * (2 ** (int(job["attempt_count"]) - 1)))
        client.rpc("retry_shelfie", {"target_id": job["id"], "error_message": message, "delay_seconds": delay}).execute()
        return
    try:
        delete_source(client, job)
        deleted_at = now_iso()
        path = None
    except Exception as delete_error:
        message += f"; source deletion failed: {delete_error}"
        deleted_at = None
        path = job.get("storage_path")
    client.table("shelfie_uploads").update({
        "status": "failed",
        "storage_path": path,
        "asset_deleted_at": deleted_at,
        "completed_at": now_iso(),
        "claimed_by": None,
        "heartbeat_at": None,
        "processing_error": message[:2000],
    }).eq("id", job["id"]).execute()


async def run() -> None:
    client = database()
    LOG.info("worker started name=%s model=%s", WORKER_NAME, MODEL)
    run_once = os.getenv("RUN_ONCE", "false").lower() == "true"
    while True:
        job = claim_next(client)
        if job:
            try:
                await process(client, job)
            except Exception as error:
                await handle_failure(client, job, error)
        if run_once:
            return
        if not job:
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    asyncio.run(run())
