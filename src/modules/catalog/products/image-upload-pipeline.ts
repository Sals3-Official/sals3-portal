import 'server-only';

import sharp from 'sharp';

/**
 * The shared validate-and-re-encode step behind every seller image upload.
 *
 * Extracted from `upload-seller-media.ts` when description images gained
 * their own upload path: two upload routes with two copies of the magic-byte
 * check, the dimension ceiling, and the WebP re-encode would drift, and the
 * one that drifted would be the one accepting a file the other refuses.
 * Where an image is *stored* and what row it produces differ per caller;
 * what counts as an acceptable image does not.
 */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_DIMENSION_PX = 2000;
export const OUTPUT_QUALITY = 82;
export const OUTPUT_CONTENT_TYPE = 'image/webp';

export type ImagePipelineRefusal =
  | { ok: false; reason: 'EMPTY_FILE' }
  | { ok: false; reason: 'FILE_TOO_LARGE'; maxBytes: number }
  | { ok: false; reason: 'UNSUPPORTED_FILE_TYPE' }
  | { ok: false; reason: 'DIMENSIONS_TOO_LARGE'; maxDimensionPx: number }
  | { ok: false; reason: 'PROCESSING_FAILED' };

export type PreparedImage = {
  ok: true;
  buffer: Buffer;
  width: number;
  height: number;
};

/**
 * Reads the file's own magic number. Never trusts the browser-supplied
 * `File.type` header, which a request can set to anything regardless of the
 * actual bytes (rule 30/66 of the Next.js security gate). Purely a cheap
 * pre-filter - `sharp` is the real decoder and the real authority on whether
 * this is a usable image.
 */
function looksLikeAcceptedImage(bytes: Uint8Array): boolean {
  const isJpeg =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;

  const isPng =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;

  const isWebp =
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50; // P

  return isJpeg || isPng || isWebp;
}

type ImageDimensions = { width: number; height: number };

/**
 * A header-only read (no full pixel decode) so an oversized image can be
 * refused before the expensive resize/re-encode step runs. `.rotate()`
 * chained ahead of `.metadata()` accounts for EXIF orientation swapping
 * width/height - moot for a square limit, but keeps this correct if the two
 * axes ever diverge. `null` on anything unreadable, same as `processImage`.
 */
async function readImageDimensions(
  bytes: Uint8Array,
): Promise<ImageDimensions | null> {
  try {
    const metadata = await sharp(bytes).rotate().metadata();

    if (metadata.width === undefined || metadata.height === undefined) {
      return null;
    }

    return { width: metadata.width, height: metadata.height };
  } catch {
    return null;
  }
}

type ProcessedImage = { buffer: Buffer; width: number; height: number };

/**
 * Auto-orient, strip metadata, re-encode as WebP. The resize call is a no-op
 * safety net by the time this runs - the caller already refused anything
 * over `MAX_DIMENSION_PX` - kept as defense in depth rather than the primary
 * size control. `null` on anything `sharp` cannot decode - a magic number is
 * not proof the rest of the file is well-formed.
 */
async function processImage(bytes: Uint8Array): Promise<ProcessedImage | null> {
  try {
    const { data, info } = await sharp(bytes)
      .rotate()
      .resize({
        width: MAX_DIMENSION_PX,
        height: MAX_DIMENSION_PX,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: OUTPUT_QUALITY })
      .toBuffer({ resolveWithObject: true });

    return { buffer: data, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

/**
 * Every refusal an uploaded file can earn before storage is touched, in the
 * order that refuses the cheapest way first: size, then magic number, then a
 * header-only dimension read, and only then the full decode.
 */
export async function prepareUploadedImage(
  fileBytes: ArrayBuffer,
): Promise<PreparedImage | ImagePipelineRefusal> {
  if (fileBytes.byteLength === 0) return { ok: false, reason: 'EMPTY_FILE' };

  if (fileBytes.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: 'FILE_TOO_LARGE', maxBytes: MAX_UPLOAD_BYTES };
  }

  const bytes = new Uint8Array(fileBytes);

  if (!looksLikeAcceptedImage(bytes)) {
    return { ok: false, reason: 'UNSUPPORTED_FILE_TYPE' };
  }

  const dimensions = await readImageDimensions(bytes);

  if (dimensions === null) return { ok: false, reason: 'PROCESSING_FAILED' };

  if (
    dimensions.width > MAX_DIMENSION_PX ||
    dimensions.height > MAX_DIMENSION_PX
  ) {
    return {
      ok: false,
      reason: 'DIMENSIONS_TOO_LARGE',
      maxDimensionPx: MAX_DIMENSION_PX,
    };
  }

  const processed = await processImage(bytes);

  if (processed === null) return { ok: false, reason: 'PROCESSING_FAILED' };

  return {
    ok: true,
    buffer: processed.buffer,
    width: processed.width,
    height: processed.height,
  };
}
