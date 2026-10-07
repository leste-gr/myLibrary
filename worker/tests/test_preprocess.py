import unittest

import numpy as np

from worker.preprocess import crop_with_padding, rotation_candidates


class PreprocessTests(unittest.TestCase):
    def test_crop_is_clamped_to_image(self):
        image = np.zeros((100, 100, 3), dtype=np.uint8)
        crop = crop_with_padding(image, (0, 0, 20, 80), padding_ratio=.1)
        self.assertEqual(crop.shape[:2], (88, 22))

    def test_returns_both_upscaled_rotations(self):
        crop = np.full((100, 20, 3), 120, dtype=np.uint8)
        rotations = rotation_candidates(crop)
        self.assertEqual([degrees for degrees, _ in rotations], [90, -90])
        self.assertTrue(all(image.shape[0] >= 1200 for _, image in rotations))


if __name__ == "__main__":
    unittest.main()
