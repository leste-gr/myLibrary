from pathlib import Path
from typing import Any

import cv2
import numpy as np
import onnxruntime as ort

from .types import SpineDetection


class YoloSpineDetector:
    def __init__(self, model_path: str | Path, image_size: int | None = None, confidence: float = 0.28, iou: float = 0.45, session: Any | None = None):
        self.confidence = confidence
        self.iou = iou
        self.session = session or ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        model_input = self.session.get_inputs()[0]
        self.input_name = model_input.name
        input_shape = getattr(model_input, "shape", None)
        model_size = input_shape[-1] if input_shape and isinstance(input_shape[-1], int) else None
        self.image_size = image_size or model_size or 960

    def _letterbox(self, image: np.ndarray) -> tuple[np.ndarray, float, int, int]:
        height, width = image.shape[:2]
        scale = min(self.image_size / width, self.image_size / height)
        resized_width, resized_height = round(width * scale), round(height * scale)
        resized = cv2.resize(image, (resized_width, resized_height), interpolation=cv2.INTER_LINEAR)
        pad_x = (self.image_size - resized_width) // 2
        pad_y = (self.image_size - resized_height) // 2
        canvas = np.full((self.image_size, self.image_size, 3), 114, dtype=np.uint8)
        canvas[pad_y:pad_y + resized_height, pad_x:pad_x + resized_width] = resized
        tensor = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB).transpose(2, 0, 1).astype(np.float32) / 255.0
        return np.expand_dims(tensor, 0), scale, pad_x, pad_y

    def detect(self, image: np.ndarray) -> list[SpineDetection]:
        tensor, scale, pad_x, pad_y = self._letterbox(image)
        raw = self.session.run(None, {self.input_name: tensor})[0]
        predictions = np.squeeze(raw)
        if predictions.ndim != 2:
            raise ValueError(f"Unexpected YOLO output shape: {raw.shape}")
        if predictions.shape[0] < predictions.shape[1] and predictions.shape[0] <= 128:
            predictions = predictions.T

        boxes: list[list[int]] = []
        scores: list[float] = []
        for row in predictions:
            if len(row) == 6 and row[4] <= 1 and row[5] <= 100 and row[2] > row[0] and row[3] > row[1]:
                x1, y1, x2, y2, score = row[:5]
            else:
                if len(row) < 5:
                    continue
                class_scores = row[4:]
                score = float(np.max(class_scores))
                x_center, y_center, width, height = row[:4]
                x1, y1 = x_center - width / 2, y_center - height / 2
                x2, y2 = x_center + width / 2, y_center + height / 2
            if score < self.confidence:
                continue
            left = round((float(x1) - pad_x) / scale)
            top = round((float(y1) - pad_y) / scale)
            right = round((float(x2) - pad_x) / scale)
            bottom = round((float(y2) - pad_y) / scale)
            left, top = max(0, left), max(0, top)
            right, bottom = min(image.shape[1], right), min(image.shape[0], bottom)
            if right - left < 8 or bottom - top < 20:
                continue
            boxes.append([left, top, right - left, bottom - top])
            scores.append(float(score))

        indices = cv2.dnn.NMSBoxes(boxes, scores, self.confidence, self.iou)
        detections = [SpineDetection(boxes[index][0], boxes[index][1], boxes[index][0] + boxes[index][2], boxes[index][1] + boxes[index][3], scores[index]) for index in np.array(indices).reshape(-1)] if len(indices) else []
        return self._separate_overlapping_spines(detections)

    @staticmethod
    def _rows(detections: list[SpineDetection]) -> list[list[SpineDetection]]:
        rows: list[list[SpineDetection]] = []
        for detection in sorted(detections, key=lambda item: ((item.y1 + item.y2) / 2, item.x1)):
            center_y = (detection.y1 + detection.y2) / 2
            matching = next((row for row in rows if abs(center_y - sum((item.y1 + item.y2) / 2 for item in row) / len(row)) <= max(30, detection.height * 0.35)), None)
            if matching is None:
                rows.append([detection])
            else:
                matching.append(detection)
        rows.sort(key=lambda row: sum(item.y1 for item in row) / len(row))
        return [sorted(row, key=lambda item: item.x1) for row in rows]

    @staticmethod
    def _separate_overlapping_spines(detections: list[SpineDetection]) -> list[SpineDetection]:
        """Turn overlapping YOLO proposals into non-overlapping spine crops.

        The training data frequently predicts a box that includes part of each
        neighboring spine. For vertically aligned books, the midpoint between
        adjacent box centers is a more stable crop boundary than either box edge.
        Gaps are retained so unrelated books are never stretched together.
        """
        separated: list[SpineDetection] = []
        for row in YoloSpineDetector._rows(detections):
            centers = [(item.x1 + item.x2) / 2 for item in row]
            for index, item in enumerate(row):
                left, right = item.x1, item.x2
                if index and row[index - 1].x2 > item.x1:
                    left = max(left, round((centers[index - 1] + centers[index]) / 2))
                if index + 1 < len(row) and item.x2 > row[index + 1].x1:
                    right = min(right, round((centers[index] + centers[index + 1]) / 2))
                if right - left >= 8:
                    separated.append(SpineDetection(left, item.y1, right, item.y2, item.confidence))
        return separated

    @staticmethod
    def _reading_order(detections: list[SpineDetection]) -> list[SpineDetection]:
        return [item for row in YoloSpineDetector._rows(detections) for item in row]
