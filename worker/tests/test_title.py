import unittest

from worker.title import extract_title
from worker.types import OcrLine


class TitleExtractionTests(unittest.TestCase):
    def test_removes_brand_and_product_code_noise(self):
        lines = [
            OcrLine("DUNGEONS & DRAGONS", .99),
            OcrLine("TSR 11552", .98),
            OcrLine("Dungeon Master's Guide", .96),
        ]
        self.assertEqual(extract_title(lines), "Dungeon Master's Guide")

    def test_deduplicates_and_drops_low_confidence_fragments(self):
        lines = [OcrLine("Out of the Abyss", .95), OcrLine("Out of the Abyss", .92), OcrLine("xx", .2)]
        self.assertEqual(extract_title(lines), "Out of the Abyss")


if __name__ == "__main__":
    unittest.main()
