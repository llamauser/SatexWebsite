import "server-only";
import sharp from "sharp";
import { dominantColors, type DominantColor } from "./colors";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface PreparedImage {
  /** Stored copy: webp, 1600 px at most, no metadata (no EXIF, no GPS). */
  stored: Buffer;
  /** Copy shown to the vision model: jpeg, 640 px at most (a fabric needs no more, and a local vision model is much faster with fewer image tokens). */
  forModel: Buffer;
  colors: DominantColor[];
}

/** Decodes the upload with sharp (anything that is not a real image fails here), removes all metadata and measures the colors. */
export async function prepareImage(bytes: Buffer): Promise<PreparedImage> {
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error("image size");
  const image = sharp(bytes, { failOn: "error", limitInputPixels: 50_000_000 }).rotate(); // rotate() applies the EXIF orientation, then drops it
  const [stored, forModel, raw] = await Promise.all([
    image.clone().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(),
    image.clone().resize(640, 640, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer(),
    image.clone().resize(64, 64, { fit: "inside" }).flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer(),
  ]);
  return { stored, forModel, colors: dominantColors(raw, 3, 3) };
}

/** "data:image/jpeg;base64,...." -> bytes. */
export function dataUrlBytes(dataUrl: string): Buffer | null {
  const m = /^data:image\/(?:jpeg|png|webp|heic|heif);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  return m ? Buffer.from(m[1]!, "base64") : null;
}
