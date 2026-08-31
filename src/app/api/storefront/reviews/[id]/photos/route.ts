import { revalidateTag } from 'next/cache';
import isStorefrontRequestAuthorized from '@/lib/storefront/auth';
import { STOREFRONT_CATALOG_TAG } from '@/lib/storefront/catalog-cache';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  IMAGE_ACCEPTED_FORMATS_COPY,
  IMAGE_MAX_DIMENSION_PX,
  IMAGE_MAX_UPLOAD_MB,
} from '@/lib/products/image-upload-limits';
import { MAX_REVIEW_PHOTOS } from '@/modules/reviews/contracts';
import type { AttachReviewPhotoResult } from '@/modules/reviews/attach-review-photo';
import {
  storefrontErrorResponse,
  STOREFRONT_HEADERS,
  unauthorizedResponse,
} from '../../../responses';

/**
 * POST /api/storefront/reviews/[id]/photos — one photo onto one review.
 *
 * ## One photo, one request, and why that is not a design preference
 *
 * The deployed platform caps a serverless request body at 4.5 MB. Four photos
 * at the 5 MB per-file ceiling this repository already enforces is several
 * times that, and the rejection happens above our code — the request never
 * arrives, so there is no branch here that could tell the buyer what went
 * wrong. Splitting them keeps every request comfortably inside the cap and, as
 * a side effect, lets each photo report its own refusal: "too wide" and "not an
 * image" ask for different things from the person holding the phone.
 *
 * ## The review exists before its photos, deliberately
 *
 * The alternative orderings are worse:
 *
 * - **Photos first, into a staging area.** Needs somewhere to keep an
 *   unattached photo — a table, or a signed token carrying an object key — and
 *   a way to sweep what is never claimed. Real machinery for a case the next
 *   paragraph handles without any.
 * - **Photos first, review after.** A submission that fails at the last step
 *   leaves paid-for storage and no review at all, which is the outcome the
 *   buyer minds most.
 *
 * Review first means a failure partway through leaves a genuine review carrying
 * two of its four photos. That is visible, it is honest, and the review — the
 * part with the rating in it — is safe. `sals3_product_review_photos_position_key`
 * makes a retry of the same position collide rather than duplicate.
 *
 * ## Authorisation is the buyer's own review, not the id in the path
 *
 * `X-Buyer-Email` decides, exactly as on the sibling submit route. A caller
 * holding the bearer token still cannot attach a photo to somebody else's
 * review, because `attachReviewPhoto` matches the address against the row
 * before it writes anything. An id alone is never enough.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/**
 * Decoding and re-encoding a 5 MB photo with `sharp` is the slowest thing this
 * route does, and the default ceiling is short enough that a large image on a
 * cold start can be cut off mid-encode. Matched to the internal migration
 * routes rather than guessed.
 */
export const maxDuration = 60;

/**
 * Tighter than the review submit's ten. A photo costs a decode, a re-encode and
 * an object write, where a review costs one insert — and four photos is the
 * whole legitimate burst for one review, so eight allows a full set plus a full
 * set of retries and nothing beyond that.
 */
const RATE_LIMIT = { capacity: 8, refillIntervalMs: 60_000 };

const REFUSALS: Record<
  Exclude<AttachReviewPhotoResult, { ok: true }>['reason'],
  { message: string; status: number }
> = {
  NOT_FOUND: { message: 'That review is no longer available.', status: 404 },
  LIMIT_REACHED: {
    message: `A review can carry ${MAX_REVIEW_PHOTOS} photos.`,
    status: 409,
  },
  EMPTY_FILE: { message: 'That file was empty.', status: 400 },
  FILE_TOO_LARGE: {
    message: `Each photo must be under ${IMAGE_MAX_UPLOAD_MB} MB.`,
    status: 413,
  },
  UNSUPPORTED_FILE_TYPE: {
    message: `Photos must be ${IMAGE_ACCEPTED_FORMATS_COPY}.`,
    status: 415,
  },
  DIMENSIONS_TOO_LARGE: {
    message: `Photos must be under ${IMAGE_MAX_DIMENSION_PX} × ${IMAGE_MAX_DIMENSION_PX} px.`,
    status: 413,
  },
  PROCESSING_FAILED: { message: 'That photo could not be read.', status: 400 },
  STORAGE_NOT_CONFIGURED: {
    message: 'Photos cannot be attached right now.',
    status: 503,
  },
  UPLOAD_FAILED: {
    message: 'The photo could not be uploaded. Try again in a moment.',
    status: 502,
  },
};

function refusal(
  reason: Exclude<AttachReviewPhotoResult, { ok: true }>['reason'],
) {
  const { message, status } = REFUSALS[reason];

  return Response.json(
    { error: message, reason },
    { status, headers: STOREFRONT_HEADERS },
  );
}

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  if (!isStorefrontRequestAuthorized(request)) {
    return unauthorizedResponse();
  }

  const buyerEmail = request.headers.get('x-buyer-email') ?? '';

  if (buyerEmail.trim() === '' || buyerEmail.length > 254) {
    return Response.json(
      { error: 'Missing buyer identity' },
      { status: 400, headers: STOREFRONT_HEADERS },
    );
  }

  if (!isDatabaseConfigured()) return refusal('STORAGE_NOT_CONFIGURED');

  const limit = checkRateLimit(
    `storefront-review-photo:${buyerEmail.trim().toLowerCase()}`,
    RATE_LIMIT,
  );

  if (!limit.allowed) {
    return Response.json(
      { error: 'Too many uploads. Wait a moment and try again.' },
      { status: 429, headers: STOREFRONT_HEADERS },
    );
  }

  const { id } = await params;

  // Shape first, so a buyer-controlled string never reaches a `uuid` column as
  // a query parameter it cannot be.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return refusal('NOT_FOUND');

  let bytes: ArrayBuffer;

  try {
    const form = await request.formData();
    const part = form.get('photo');

    if (!(part instanceof File)) return refusal('EMPTY_FILE');

    bytes = await part.arrayBuffer();
  } catch {
    return refusal('EMPTY_FILE');
  }

  try {
    // Imported lazily so `sharp` and the storage client are not pulled into
    // this route's cold start, matching every other upload path here.
    const { default: attachReviewPhoto } =
      await import('@/modules/reviews/attach-review-photo');
    const result = await attachReviewPhoto({
      reviewId: id,
      buyerEmail,
      fileBytes: bytes,
    });

    if (!result.ok) return refusal(result.reason);

    // A photo changes what the product page shows, and the review list rides
    // the same catalog tag the aggregate does.
    revalidateTag(STOREFRONT_CATALOG_TAG, 'max');

    return Response.json(
      { photoId: result.photoId, position: result.position },
      { status: 201, headers: STOREFRONT_HEADERS },
    );
  } catch (error) {
    return storefrontErrorResponse(`POST /reviews/${id}/photos`, error);
  }
}
