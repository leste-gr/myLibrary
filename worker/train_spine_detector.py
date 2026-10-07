import json
import os
import shutil
from pathlib import Path

from roboflow import Roboflow
from ultralytics import YOLO


def required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def main() -> None:
    dataset_path = os.getenv("YOLO_DATASET_PATH")
    if dataset_path:
        data_yaml = Path(dataset_path) / "data.yaml"
    else:
        roboflow = Roboflow(api_key=required("ROBOFLOW_API_KEY"))
        project = roboflow.workspace(os.getenv("ROBOFLOW_WORKSPACE", "bookdetection-lgtpa")).project(os.getenv("ROBOFLOW_PROJECT", "book-spine-detector"))
        dataset = project.version(int(os.getenv("ROBOFLOW_VERSION", "4"))).download("yolov8")
        data_yaml = Path(dataset.location) / "data.yaml"
    image_size = int(os.getenv("YOLO_IMAGE_SIZE", "640"))
    resume_path = os.getenv("YOLO_RESUME_FROM")
    model = YOLO(resume_path or os.getenv("YOLO_BASE_MODEL", "yolo11n.pt"))
    if resume_path:
        result = model.train(resume=True)
    else:
        result = model.train(
            data=str(data_yaml),
            epochs=int(os.getenv("YOLO_EPOCHS", "60")),
            imgsz=image_size,
            batch=int(os.getenv("YOLO_BATCH_SIZE", "8")),
            patience=15,
            project="training-runs",
            name="book-spines",
        )
    best = YOLO(str(Path(result.save_dir) / "weights" / "best.pt"))
    validation = best.val(data=str(data_yaml), split="test", imgsz=image_size)
    exported = Path(best.export(format="onnx", imgsz=image_size, opset=12, simplify=True, dynamic=False))
    target = Path("artifacts/spine-yolo.onnx")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(exported, target)
    metrics = {
        "precision": float(validation.box.mp),
        "recall": float(validation.box.mr),
        "map50": float(validation.box.map50),
        "map50_95": float(validation.box.map),
        "image_size": image_size,
        "dataset": str(data_yaml),
    }
    (target.parent / "spine-yolo-metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")
    print(json.dumps(metrics))
    print(target)


if __name__ == "__main__":
    main()
