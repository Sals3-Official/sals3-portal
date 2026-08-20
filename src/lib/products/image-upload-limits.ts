/**
 * What a seller may upload, in words a seller can read before picking a file.
 *
 * The limits themselves are enforced in
 * `@/modules/catalog/products/image-upload-pipeline`, which is `server-only`
 * because it imports `sharp`. A client component cannot import that module, so
 * every upload surface in the editor spelled the same numbers out by hand — and
 * they had already drifted: one said `JPEG, PNG, or WebP · up to 5 MB · 2000 ×
 * 2000 px`, another `Max 2000 × 2000 px · JPG, PNG, or WebP, up to 5 MB each`,
 * and the description studio's own upload panel said nothing at all.
 *
 * One copy here, and `image-upload-limits.test.ts` asserts these numbers against
 * the pipeline's own constants, so a raised ceiling that forgets this file is a
 * failing test rather than a caption that quietly lies to a seller.
 */

export const IMAGE_MAX_UPLOAD_MB = 5;
export const IMAGE_MAX_DIMENSION_PX = 2_000;

/** The accepted formats, as the file picker's own `accept` list reads them. */
export const IMAGE_ACCEPTED_FORMATS_COPY = 'JPG, PNG, or WebP';

/**
 * The whole sentence, for a caption beside an upload control. Dimensions before
 * bytes: a file too wide is the refusal a seller hits first, because a phone
 * photo is routinely over 2000 px and rarely over 5 MB.
 */
export const IMAGE_UPLOAD_LIMITS_COPY = `${IMAGE_ACCEPTED_FORMATS_COPY} · up to ${IMAGE_MAX_DIMENSION_PX} × ${IMAGE_MAX_DIMENSION_PX} px · max ${IMAGE_MAX_UPLOAD_MB} MB`;
