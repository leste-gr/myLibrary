import cv2
import numpy as np

from .detector import YoloSpineDetector
from .ocr import PaddleSpineOcr
from .preprocess import crop_with_padding, rotation_candidates
from .types import SpineResult


class ShelfieExtractionPipeline:
    def __init__(self, detector: YoloSpineDetector, ocr: PaddleSpineOcr):
        self.detector = detector
        self.ocr = ocr

    def extract_bytes(self, payload: bytes) -> list[SpineResult]:
        image = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            try:
                from io import BytesIO
                from PIL import Image
                from pillow_heif import register_heif_opener
                register_heif_opener()
                rgb = np.asarray(Image.open(BytesIO(payload)).convert("RGB"))
                image = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
            except Exception as error:
                raise ValueError("Shelfie is not a decodable image") from error
        return self.extract(image)

    def extract(self, image: np.ndarray) -> list[SpineResult]:
        results: list[SpineResult] = []
        for detection in self.detector.detect(image):
            crop = crop_with_padding(image, (detection.x1, detection.y1, detection.x2, detection.y2))
            rotations = []
            for degrees, prepared in rotation_candidates(crop):
                lines, confidence = self.ocr.read(prepared)
                rotations.append((confidence, degrees, lines))
            confidence, degrees, lines = max(rotations, key=lambda item: item[0])
            results.append(SpineResult(detection=detection, crop=crop, rotation=degrees, confidence=confidence, lines=lines))
        return results
