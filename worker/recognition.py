import base64
import json
from dataclasses import dataclass

from openai import OpenAI


@dataclass
class DetectedBook:
    title: str
    author: str
    publisher: str | None = None
    language: str | None = None
    isbn: str | None = None
    confidence: float = 0.0


SCHEMA = {
    "type": "object",
    "properties": {
        "books": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "author": {"type": "string"},
                    "publisher": {"type": ["string", "null"]},
                    "language": {"type": ["string", "null"]},
                    "isbn": {"type": ["string", "null"]},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                },
                "required": ["title", "author", "publisher", "language", "isbn", "confidence"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["books"],
    "additionalProperties": False,
}


def recognize_books(image: bytes, content_type: str, model: str) -> list[DetectedBook]:
    encoded = base64.b64encode(image).decode("ascii")
    response = OpenAI().responses.create(
        model=model,
        input=[{
            "role": "user",
            "content": [
                {"type": "input_text", "text": (
                    "Identify every distinct physical book whose spine is readable in this shelf photo. "
                    "Transcribe title and author conservatively; do not invent missing text. Use an empty "
                    "string for an unreadable title or author. ISBN is normally not visible on a spine, so "
                    "return null unless its digits are actually visible. Preserve the reading order from "
                    "left to right, top shelf to bottom shelf."
                )},
                {"type": "input_image", "image_url": f"data:{content_type};base64,{encoded}", "detail": "high"},
            ],
        }],
        text={"format": {"type": "json_schema", "name": "shelf_books", "strict": True, "schema": SCHEMA}},
    )
    payload = json.loads(response.output_text)
    return [DetectedBook(**book) for book in payload["books"] if book.get("title") or book.get("author")]
