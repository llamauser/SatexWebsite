import "server-only";
import sharp from "sharp";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // the same limit as the fabric-images bucket
export const MAX_SIDE_PX = 2000;
const ACCEPTED = new Set(["jpeg", "png", "webp"]);

export type ImageRejection = "size" | "format" | "decode";
export class ImageRejected extends Error {
  constructor(readonly code: ImageRejection) {
    super(`image rejected: ${code}`);
  }
}

export interface ReencodedPhoto {
  data: Buffer;
  width: number;
  height: number;
  contentType: "image/webp";
}

/**
 * The one way a photo uploaded by an admin enters the site: decoded with sharp (so only real images pass, whatever the file name or the
 * declared type says), turned upright and stripped of every piece of metadata (EXIF, GPS position, camera and software names, embedded
 * thumbnails and color profiles other than sRGB), limited to 2000 px and stored as WebP. Throws ImageRejected.
 */
export async function reencodePhoto(bytes: Buffer): Promise<ReencodedPhoto> {
  if (bytes.length === 0 || bytes.length > MAX_UPLOAD_BYTES) throw new ImageRejected("size");
  try {
    const image = sharp(bytes, { failOn: "error", limitInputPixels: 60_000_000 });
    const meta = await image.metadata();
    // sharp reports an AVIF file as the container "heif"; HEIC (HEVC) is not accepted: browsers cannot show it
    const avif = meta.format === "heif" && meta.compression === "av1";
    if (!avif && (!meta.format || !ACCEPTED.has(meta.format))) throw new ImageRejected("format");
    const { data, info } = await image
      .rotate() // applies the EXIF orientation, then the tag is gone with the rest of the metadata
      .resize(MAX_SIDE_PX, MAX_SIDE_PX, { fit: "inside", withoutEnlargement: true })
      .toColorspace("srgb")
      .webp({ quality: 86 }) // no withMetadata(): sharp writes none
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, contentType: "image/webp" };
  } catch (e) {
    if (e instanceof ImageRejected) throw e;
    throw new ImageRejected("decode");
  }
}
