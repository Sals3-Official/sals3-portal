import isStorefrontRequestAuthorized from '@/lib/storefront/auth';
import { getStorefrontCjProducts } from '@/lib/storefront/cj-feed';
import { listStorefrontCategories } from '@/lib/storefront/feed';
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
    const page = await getStorefrontCjProducts({
      cjPage: 1,
      cjSearch: '',
      cjPid: '',
    });

    return Response.json(listStorefrontCategories(page.products), {
      headers: HEADERS,
    });
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
