from collections.abc import Iterable
from typing import Any

import numpy as np

from .types import OcrLine


class PaddleSpineOcr:
    def __init__(self, engines: dict[str, Any] | None = None):
        if engines is None:
            from paddleocr import PaddleOCR
            engines = {
                "el": PaddleOCR(lang="el", enable_mkldnn=False, use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False),
                "en": PaddleOCR(lang="en", enable_mkldnn=False, use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False),
            }
        self.engines = engines

    @staticmethod
    def _parse(result: Any, language: str) -> list[OcrLine]:
        modern = PaddleSpineOcr._modern_payload(result)
        if modern is not None:
            texts = modern.get("rec_texts", [])
            scores = modern.get("rec_scores", [])
            boxes = modern.get("rec_polys", modern.get("dt_polys", []))
            return [OcrLine(text=str(text).strip(), confidence=float(scores[index]), box=np.asarray(boxes[index], dtype=float).tolist() if index < len(boxes) else [], language=language) for index, text in enumerate(texts) if str(text).strip() and index < len(scores)]
        page = result[0] if isinstance(result, list) and result else []
        lines: list[OcrLine] = []
        for item in page or []:
            if not isinstance(item, (list, tuple)) or len(item) < 2:
                continue
            box, recognition = item[0], item[1]
            if not isinstance(recognition, (list, tuple)) or len(recognition) < 2:
                continue
            text, confidence = str(recognition[0]).strip(), float(recognition[1])
            if text:
                lines.append(OcrLine(text=text, confidence=confidence, box=np.asarray(box, dtype=float).tolist(), language=language))
        return lines

    @staticmethod
    def _modern_payload(result: Any) -> dict[str, Any] | None:
        if not isinstance(result, list) or not result:
            return None
        first = result[0]
        if isinstance(first, dict):
            value = first
        else:
            value = getattr(first, "json", None)
            if callable(value):
                value = value()
        if not isinstance(value, dict):
            return None
        payload = value.get("res", value)
        return payload if isinstance(payload, dict) and "rec_texts" in payload else None

    @staticmethod
    def score(lines: Iterable[OcrLine]) -> float:
        retained = [line for line in lines if line.confidence >= 0.2 and line.text.strip()]
        if not retained:
            return 0.0
        character_weight = sum(max(1, len(line.text.strip())) for line in retained)
        return sum(line.confidence * max(1, len(line.text.strip())) for line in retained) / character_weight

    def read(self, image: np.ndarray) -> tuple[list[OcrLine], float]:
        alternatives: list[tuple[list[OcrLine], float]] = []
        for language, engine in self.engines.items():
            if hasattr(engine, "predict"):
                raw = engine.predict(image, use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False)
            else:
                raw = engine.ocr(image, cls=False)
            lines = self._parse(raw, language)
            alternatives.append((lines, self.score(lines)))
        return max(alternatives, key=lambda item: item[1], default=([], 0.0))
