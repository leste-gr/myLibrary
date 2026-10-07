import hashlib
import os
from pathlib import Path

import httpx


def ensure_model() -> Path:
    path = Path(os.getenv("SPINE_MODEL_PATH", "/app/models/spine-yolo.onnx"))
    expected_sha256 = os.getenv("SPINE_MODEL_SHA256", "").lower()
    if not path.exists():
        url = os.getenv("SPINE_MODEL_URL")
        if not url:
            raise RuntimeError("Spine model is missing. Set SPINE_MODEL_URL or bake SPINE_MODEL_PATH into the image.")
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".download")
        with httpx.stream("GET", url, timeout=120, follow_redirects=True) as response:
            response.raise_for_status()
            with temporary.open("wb") as target:
                for chunk in response.iter_bytes():
                    target.write(chunk)
        temporary.replace(path)
    if expected_sha256:
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != expected_sha256:
            raise RuntimeError(f"Spine model checksum mismatch: expected {expected_sha256}, got {actual}")
    return path
