import {
  storefrontFeedQuerySchema,
  toStorefrontProductFeed,
} from '@/lib/storefront/feed';
import isStorefrontRequestAuthorized from '@/lib/storefront/auth';
import { getStorefrontCjProducts } from '@/lib/storefront/cj-feed';
import { CjApiError } from '@/services/cj/config';

export const dynamic = 'force-dynamic';

const HEADERS = {
  'Cache-Control': 'private, no-store',
};

export async function GET(request: Request) {
  if (!isStorefrontRequestAuthorized(request)) {
    return Response.json(
      { error: 'Unauthorized' },
      { status: 401, headers: HEADERS },
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const query = storefrontFeedQuerySchema.parse({
      section: searchParams.get('section') ?? undefined,
      page: searchParams.get('page') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
    });
    const cjPage = await getStorefrontCjProducts({
      cjPage: query.page,
      cjSearch: '',
      cjPid: '',
    });

    return Response.json(
      toStorefrontProductFeed(
        cjPage.products,
        query,
        cjPage.total,
        cjPage.totalPages,
      ),
      { headers: HEADERS },
    );
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
