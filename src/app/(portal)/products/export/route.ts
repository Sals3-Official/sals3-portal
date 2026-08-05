import { productsToCsv } from '@/lib/products/csv';
import { productListQuerySchema } from '@/lib/products/schemas';
import { listProducts } from '@/services/products';
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';

/**
 * CSV export.
 *
 * The permission check runs before any read, and the rows come from the same
 * authorized service the list page uses, so an export can never return products
 * the role cannot see. The response is marked private and no-store: an export
 * holds cost prices and must not sit in a shared cache.
 */
export async function GET(request: Request) {
  try {
    await requirePermission('product:export');
  } catch (error) {
    if (error instanceof PermissionError) {
      return new Response('You do not have permission to export products.', {
        status: 403,
      });
    }

    throw error;
  }

  const url = new URL(request.url);
  const query = productListQuerySchema.parse({
    ...Object.fromEntries(url.searchParams),
    perPage: 100,
    page: 1,
  });
  const result = await listProducts({ ...query, perPage: 100 });

  return new Response(productsToCsv(result.products), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sals3-products.csv"',
      'Cache-Control': 'private, no-store',
    },
  });
}
