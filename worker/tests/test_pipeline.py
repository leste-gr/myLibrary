import unittest

import numpy as np

from worker.pipeline import ShelfieExtractionPipeline
from worker.types import OcrLine, SpineDetection


class FakeDetector:
    def detect(self, _image):
        return [SpineDetection(10, 10, 30, 90, .88)]


class FakeOcr:
    def __init__(self):
        self.calls = 0

    def read(self, _image):
        self.calls += 1
        confidence = .4 if self.calls == 1 else .92
        return [OcrLine("Dune", confidence, language="en")], confidence


class PipelineTests(unittest.TestCase):
    def test_keeps_higher_confidence_rotation(self):
        pipeline = ShelfieExtractionPipeline(FakeDetector(), FakeOcr())
        result = pipeline.extract(np.full((100, 50, 3), 120, dtype=np.uint8))[0]
        self.assertEqual(result.rotation, -90)
        self.assertAlmostEqual(result.confidence, .92)
        self.assertEqual(result.text, "Dune")


if __name__ == "__main__":
    unittest.main()
