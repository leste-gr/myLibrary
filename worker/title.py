import re

from .types import OcrLine


BRAND = re.compile(r"\b(?:ADVANCED\s*)?DUNGEONS\s*(?:&|AND)?\s*DRAGONS(?:®|™)?\b", re.IGNORECASE)
PRODUCT_CODE = re.compile(r"\bTSR\s*\d{4,6}\b", re.IGNORECASE)


def extract_title(lines: list[OcrLine]) -> str:
    """Return concise matching text while retaining raw OCR lines as evidence."""
    parts: list[str] = []
    seen: set[str] = set()
    for line in lines:
        if line.confidence < 0.35:
            continue
        text = PRODUCT_CODE.sub(" ", BRAND.sub(" ", line.text))
        text = re.sub(r"\s+", " ", text).strip(" -–—·|:;")
        key = re.sub(r"[^a-z0-9]+", "", text.casefold())
        if len(key) < 3 or key in seen:
            continue
        seen.add(key)
        parts.append(text)
    return " ".join(parts)[:240].strip()
