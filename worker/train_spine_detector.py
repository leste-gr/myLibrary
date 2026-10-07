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
    roboflow = Roboflow(api_key=required("ROBOFLOW_API_KEY"))
    project = roboflow.workspace(required("ROBOFLOW_WORKSPACE")).project(required("ROBOFLOW_PROJECT"))
    dataset = project.version(int(required("ROBOFLOW_VERSION"))).download("yolov8")
    model = YOLO(os.getenv("YOLO_BASE_MODEL", "yolo11n.pt"))
    result = model.train(
        data=str(Path(dataset.location) / "data.yaml"),
        epochs=int(os.getenv("YOLO_EPOCHS", "80")),
        imgsz=int(os.getenv("YOLO_IMAGE_SIZE", "960")),
        batch=int(os.getenv("YOLO_BATCH_SIZE", "8")),
        patience=15,
        project="training-runs",
        name="book-spines",
    )
    best = YOLO(str(Path(result.save_dir) / "weights" / "best.pt"))
    exported = Path(best.export(format="onnx", imgsz=int(os.getenv("YOLO_IMAGE_SIZE", "960")), opset=12, simplify=True, dynamic=False))
    target = Path("artifacts/spine-yolo.onnx")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(exported, target)
    print(target)


if __name__ == "__main__":
    main()
