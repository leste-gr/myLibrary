import asyncio
import logging
import os
import socket
from datetime import UTC, datetime
from typing import Any

from supabase import Client, create_client

from .detector import YoloSpineDetector
from .model import ensure_model
from .ocr import PaddleSpineOcr
from .pipeline import ShelfieExtractionPipeline
from .types import SpineResult


logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
LOG = logging.getLogger("shelfie-worker")
POLL_SECONDS = int(os.getenv("POLL_SECONDS", "10"))
MAX_ATTEMPTS = int(os.getenv("MAX_ATTEMPTS", "3"))
WORKER_NAME = os.getenv("WORKER_NAME", socket.gethostname())


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def database() -> Client:
    return create_client(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"))


def build_pipeline() -> ShelfieExtractionPipeline:
    return ShelfieExtractionPipeline(YoloSpineDetector(ensure_model()), PaddleSpineOcr())


def claim_next(client: Client) -> dict[str, Any] | None:
    rows = client.rpc("claim_next_shelfie", {"worker_name": WORKER_NAME}).execute().data or []
    return rows[0] if rows else None


def observation_payload(job: dict[str, Any], result: SpineResult, index: int) -> dict[str, Any]:
    detection = result.detection
    return {
        "collection_id": job["collection_id"],
        "shelfie_upload_id": job["id"],
        "detection_index": index,
        "source_type": "shelfie",
        "source_asset_url": None,
        "crop_asset_url": None,
        "title_text": result.text or None,
        "confidence": result.confidence,
        "status": "ready_for_matching" if result.text else "unresolved",
        "raw_payload": {
            "bbox": [detection.x1, detection.y1, detection.x2, detection.y2],
            "detector_confidence": detection.confidence,
            "ocr_confidence": result.confidence,
            "rotation": result.rotation,
            "ocr_lines": [{"text": line.text, "confidence": line.confidence, "language": line.language, "box": line.box} for line in result.lines],
            "pipeline": "yolo-onnx-paddleocr-v2",
        },
    }


def save_result(client: Client, job: dict[str, Any], result: SpineResult, index: int) -> None:
    existing = client.table("book_observations").select("id").eq("shelfie_upload_id", job["id"]).eq("detection_index", index).limit(1).execute().data
    payload = observation_payload(job, result, index)
    if existing:
        observation_id = existing[0]["id"]
        client.table("book_observations").update(payload).eq("id", observation_id).execute()
        client.table("observation_tokens").delete().eq("observation_id", observation_id).execute()
    else:
        observation_id = client.table("book_observations").insert(payload).execute().data[0]["id"]
    tokens = [{
        "observation_id": observation_id,
        "text": line.text,
        "normalized_text": line.text.casefold().strip(),
        "bounding_box": line.box,
        "confidence": line.confidence,
        "reading_order": order,
        "token_type": "unknown",
    } for order, line in enumerate(result.lines)]
    if tokens:
        client.table("observation_tokens").insert(tokens).execute()


def delete_source(client: Client, job: dict[str, Any]) -> None:
    if job.get("storage_path"):
        client.storage.from_("shelfies").remove([job["storage_path"]])


def process(client: Client, pipeline: ShelfieExtractionPipeline, job: dict[str, Any]) -> None:
    path = job.get("storage_path")
    if not path:
        raise RuntimeError("Shelfie has no storage path")
    image = client.storage.from_("shelfies").download(path)
    client.table("shelfie_uploads").update({"heartbeat_at": now_iso()}).eq("id", job["id"]).execute()
    results = pipeline.extract_bytes(image)
    if not results:
        raise RuntimeError("No book spines were detected")
    for index, result in enumerate(results):
        save_result(client, job, result, index)
        client.table("shelfie_uploads").update({"heartbeat_at": now_iso()}).eq("id", job["id"]).execute()
    delete_source(client, job)
    client.table("shelfie_uploads").update({
        "status": "completed",
        "storage_path": None,
        "asset_deleted_at": now_iso(),
        "completed_at": now_iso(),
        "detected_book_count": len(results),
        "claimed_by": None,
        "heartbeat_at": None,
        "processing_error": None,
    }).eq("id", job["id"]).execute()
    LOG.info("completed shelfie=%s spines=%d", job["id"], len(results))


def handle_failure(client: Client, job: dict[str, Any], error: Exception) -> None:
    message = f"{type(error).__name__}: {error}"
    LOG.exception("failed shelfie=%s attempt=%s", job["id"], job["attempt_count"])
    if int(job["attempt_count"]) < MAX_ATTEMPTS:
        delay = min(1800, 60 * (2 ** (int(job["attempt_count"]) - 1)))
        client.rpc("retry_shelfie", {"target_id": job["id"], "error_message": message, "delay_seconds": delay}).execute()
        return
    deleted_at, storage_path = None, job.get("storage_path")
    try:
        delete_source(client, job)
        deleted_at, storage_path = now_iso(), None
    except Exception as deletion_error:
        message += f"; source deletion failed: {deletion_error}"
    client.table("shelfie_uploads").update({
        "status": "failed",
        "storage_path": storage_path,
        "asset_deleted_at": deleted_at,
        "completed_at": now_iso(),
        "claimed_by": None,
        "heartbeat_at": None,
        "processing_error": message[:2000],
    }).eq("id", job["id"]).execute()


async def run() -> None:
    client = database()
    pipeline: ShelfieExtractionPipeline | None = None
    run_mode = os.getenv("RUN_MODE", "once" if os.getenv("RUN_ONCE", "false").lower() == "true" else "poll").lower()
    if run_mode not in {"poll", "once", "drain"}:
        raise RuntimeError("RUN_MODE must be poll, once, or drain")
    LOG.info("worker started name=%s mode=%s", WORKER_NAME, run_mode)
    while True:
        job = claim_next(client)
        if job:
            if pipeline is None:
                pipeline = build_pipeline()
            try:
                await asyncio.to_thread(process, client, pipeline, job)
            except Exception as error:
                handle_failure(client, job, error)
            if run_mode == "once":
                return
            continue
        if run_mode in {"once", "drain"}:
            LOG.info("queue empty; worker exiting")
            return
        await asyncio.sleep(POLL_SECONDS)


if __name__ == "__main__":
    asyncio.run(run())
