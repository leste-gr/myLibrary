import unittest

from worker.ocr import PaddleSpineOcr
from worker.types import OcrLine


class OcrTests(unittest.TestCase):
    def test_parses_modern_paddle_result(self):
        result = [{"res": {"rec_texts": ["Dune"], "rec_scores": [0.93], "rec_polys": [[[0, 0], [10, 0], [10, 5], [0, 5]]]}}]
        lines = PaddleSpineOcr._parse(result, "en")
        self.assertEqual(lines[0].text, "Dune")
        self.assertAlmostEqual(lines[0].confidence, .93)

    def test_score_is_character_weighted(self):
        score = PaddleSpineOcr.score([OcrLine("Long title", .9), OcrLine("x", .1)])
        self.assertGreater(score, .8)


if __name__ == "__main__":
    unittest.main()
