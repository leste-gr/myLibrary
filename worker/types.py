from dataclasses import dataclass, field

import numpy as np


@dataclass(frozen=True)
class SpineDetection:
    x1: int
    y1: int
    x2: int
    y2: int
    confidence: float

    @property
    def width(self) -> int:
        return self.x2 - self.x1

    @property
    def height(self) -> int:
        return self.y2 - self.y1


@dataclass(frozen=True)
class OcrLine:
    text: str
    confidence: float
    box: list[list[float]] = field(default_factory=list)
    language: str | None = None


@dataclass
class SpineResult:
    detection: SpineDetection
    crop: np.ndarray
    rotation: int
    confidence: float
    lines: list[OcrLine]

    @property
    def text(self) -> str:
        return " ".join(line.text for line in self.lines if line.text).strip()
