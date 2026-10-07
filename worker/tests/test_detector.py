import unittest

import numpy as np

from worker.detector import YoloSpineDetector
from worker.types import SpineDetection


class _Input:
    name = "images"


class FakeSession:
    def get_inputs(self):
        return [_Input()]

    def run(self, _outputs, feed):
        assert feed["images"].shape == (1, 3, 960, 960)
        output = np.zeros((1, 5, 10), dtype=np.float32)
        output[0, :, 0] = [120, 480, 144, 384, 0.9]
        return [output]


class DetectorTests(unittest.TestCase):
    def test_decodes_yolo_output_back_to_source_coordinates(self):
        image = np.zeros((100, 200, 3), dtype=np.uint8)
        detections = YoloSpineDetector("unused.onnx", session=FakeSession()).detect(image)
        self.assertEqual(len(detections), 1)
        self.assertEqual((detections[0].x1, detections[0].y1, detections[0].x2, detections[0].y2), (10, 10, 40, 90))

    def test_orders_shelves_top_to_bottom_and_left_to_right(self):
        items = [SpineDetection(80, 100, 100, 200, .9), SpineDetection(50, 0, 70, 90, .9), SpineDetection(10, 100, 30, 200, .9)]
        ordered = YoloSpineDetector._reading_order(items)
        self.assertEqual([(item.x1, item.y1) for item in ordered], [(50, 0), (10, 100), (80, 100)])


if __name__ == "__main__":
    unittest.main()
