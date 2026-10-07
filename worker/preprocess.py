import cv2
import numpy as np


def crop_with_padding(image: np.ndarray, box: tuple[int, int, int, int], padding_ratio: float = 0.025) -> np.ndarray:
    x1, y1, x2, y2 = box
    pad_x = round((x2 - x1) * padding_ratio)
    pad_y = round((y2 - y1) * padding_ratio)
    return image[max(0, y1 - pad_y):min(image.shape[0], y2 + pad_y), max(0, x1 - pad_x):min(image.shape[1], x2 + pad_x)].copy()


def enhance_for_ocr(image: np.ndarray, minimum_height: int = 1200) -> np.ndarray:
    if image.size == 0:
        raise ValueError("Cannot preprocess an empty spine crop")
    height, width = image.shape[:2]
    scale = max(1.0, minimum_height / height)
    if scale > 1:
        image = cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_CUBIC)
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    luminance, channel_a, channel_b = cv2.split(lab)
    luminance = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(luminance)
    return cv2.cvtColor(cv2.merge((luminance, channel_a, channel_b)), cv2.COLOR_LAB2BGR)


def rotation_candidates(crop: np.ndarray) -> list[tuple[int, np.ndarray]]:
    return [
        (90, enhance_for_ocr(cv2.rotate(crop, cv2.ROTATE_90_CLOCKWISE))),
        (-90, enhance_for_ocr(cv2.rotate(crop, cv2.ROTATE_90_COUNTERCLOCKWISE))),
    ]
