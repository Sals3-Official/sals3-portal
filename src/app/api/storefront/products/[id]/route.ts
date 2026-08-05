import isStorefrontRequestAuthorized from '@/lib/storefront/auth';
import { getStorefrontCjProducts } from '@/lib/storefront/cj-feed';
import { toStorefrontProduct } from '@/lib/storefront/feed';
import { CjApiError } from '@/services/cj/config';

export const dynamic = 'force-dynamic';

const HEADERS = {
  'Cache-Control': 'private, no-store',
};

type RouteContext = {
  params: Promise<{ id: string }>;
};

function notFound() {
  return Response.json(
    { error: 'Not found' },
    { status: 404, headers: HEADERS },
  );
}

export async function GET(request: Request, { params }: RouteContext) {
  if (!isStorefrontRequestAuthorized(request)) {
    return Response.json(
      { error: 'Unauthorized' },
      { status: 401, headers: HEADERS },
    );
  }

  const { id } = await params;

  if (id.trim() === '') {
    return notFound();
  }

  try {
    const page = await getStorefrontCjProducts({
      cjPage: 1,
      cjSearch: '',
      cjPid: id,
    });
    // CJ's `pid` filter is documented as an exact-identifier filter, but the
    // id this route receives is our own slugified form of it (lowercased,
    // non-alphanumeric runs collapsed to a hyphen) - confirm the match
    // case-insensitively rather than trusting CJ's filter alone.
    const match = page.products.find(
      (product) => product.id.toLowerCase() === id.toLowerCase(),
    );
    const product =
      match === undefined ? null : toStorefrontProduct(match, 'for-you');

    if (product === null) {
      return notFound();
    }

    return Response.json({ product }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof CjApiError) {
      return Response.json(
        { error: 'CJ supplier feed unavailable' },
        { status: 502, headers: HEADERS },
      );
    }

    throw error;
  }
}
