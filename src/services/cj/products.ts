import { requirePermission } from '@/lib/auth/session';
import { normalizeCjProduct, type CjProduct } from '@/lib/cj/normalize';
import { cjProductListSchema, type CjQuery } from '@/lib/cj/schemas';
import {
  CJ_BASE_URL,
  CJ_LIST_REVALIDATE_SECONDS,
  CJ_PAGE_SIZE,
  CjApiError,
} from './config';
import { getCjAccessToken } from './token';

/**
 * Reads the CJdropshipping supplier catalogue.
 *
 * The portal permission is checked before any upstream call, so a role that
 * cannot read products cannot use this integration as a side door. The response
 * is cached for five minutes: the catalogue changes slowly, CJ allows only one
 * call per second, and a page refresh should not spend an upstream call.
 */

export type CjProductPage = {
  products: CjProduct[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const MAX_PAGES = 500;

function buildUrl(query: CjQuery): string {
  const params = new URLSearchParams({
    pageNum: String(query.cjPage),
    pageSize: String(CJ_PAGE_SIZE),
  });

  if (query.cjSearch !== '') {
    params.set('productNameEn', query.cjSearch);
  }

  if (query.cjPid !== '') {
    params.set('pid', query.cjPid);
  }

  return `${CJ_BASE_URL}/product/list?${params.toString()}`;
}

export async function fetchCjProducts(query: CjQuery): Promise<CjProductPage> {
  await requirePermission('product:read');

  const token = await getCjAccessToken();
  const response = await fetch(buildUrl(query), {
    headers: { 'CJ-Access-Token': token },
    next: { revalidate: CJ_LIST_REVALIDATE_SECONDS },
  });

  if (response.status === 429) {
    throw new CjApiError('rate-limited');
  }

  if (!response.ok) {
    throw new CjApiError('upstream-unavailable');
  }

  const parsed = cjProductListSchema.safeParse(await response.json());

  if (!parsed.success) {
    throw new CjApiError('unexpected-response');
  }

  if (parsed.data.code !== 200) {
    throw new CjApiError(
      parsed.data.code === 401
        ? 'authentication-failed'
        : 'unexpected-response',
    );
  }

  const data = parsed.data.data ?? null;
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? CJ_PAGE_SIZE;

  return {
    products: (data?.list ?? []).map(normalizeCjProduct),
    page: data?.pageNum ?? query.cjPage,
    pageSize,
    total,
    totalPages: Math.min(
      MAX_PAGES,
      Math.max(1, Math.ceil(total / Math.max(pageSize, 1))),
    ),
  };
}
