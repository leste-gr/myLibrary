import sharp from "sharp";
import { MAX_COVER_UPLOAD_BYTES } from "./book-cover";
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function prepareCoverUpload(file: File) {
  if (!file.size) throw new Error("Choose a cover image to upload.");
  if (file.size > MAX_COVER_UPLOAD_BYTES) throw new Error("The cover image must be 4 MB or smaller.");
  if (!IMAGE_TYPES.has(file.type)) throw new Error("Choose a JPG, PNG or WebP image.");
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const image = sharp(input, { limitInputPixels: 40_000_000, failOn: "warning" });
    const metadata = await image.metadata();
    if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) throw new Error("Unsupported format.");
    // Decode and re-encode: strip metadata, apply orientation and reject corrupt files.
    const output = await image.rotate().resize({ width: 1600, height: 2400, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 90 }).toBuffer();
    if (output.byteLength > MAX_COVER_UPLOAD_BYTES) throw new Error("Image too large.");
    return output;
  } catch {
    throw new Error("This image could not be read. Choose a valid JPG, PNG or WebP file.");
  }
}
