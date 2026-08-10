import type { CatalogPage } from '@/modules/suppliers/contracts';

/**
 * Fail-closed validation of one legacy `/product/list` response against the
 * complete invalid-pagination matrix (turnover contract + ADR-013 §3). A
 * response failing ANY check is never ingested, never advances a checkpoint,
 * and never marks coverage - the caller records the exact error code and
 * keeps the partition visibly incomplete.
 *
 * Note what is deliberately ABSENT: any rule about a 6,000 total. That value
 * is documented for Product List V2 only; on the legacy endpoint a total at
 * or beyond 6,000 is ordinary density data and validates like any other.
 */

export type PageValidationResult =
  { ok: true } | { ok: false; errorCode: string; detail: string };

export type PageExpectation = {
  requestedPageNum: number;
  requestedPageSize: number;
};

function invalid(errorCode: string, detail: string): PageValidationResult {
  return { ok: false, errorCode, detail };
}

export default function validateCatalogPage(
  page: CatalogPage,
  expectation: PageExpectation,
): PageValidationResult {
  // Returned page identity differs from the requested page.
  if (!Number.isInteger(page.pageNum)) {
    return invalid(
      'PROVIDER_PAGE_IDENTITY_INVALID',
      'Returned page number is not an integer.',
    );
  }
  if (page.pageNum !== expectation.requestedPageNum) {
    return invalid(
      'PROVIDER_PAGE_IDENTITY_MISMATCH',
      `Requested page ${expectation.requestedPageNum} but the provider returned page ${page.pageNum}.`,
    );
  }

  // Page size must be a positive integer no larger than requested/documented.
  if (!Number.isInteger(page.pageSize) || page.pageSize <= 0) {
    return invalid(
      'PROVIDER_PAGE_SIZE_INVALID',
      'Returned page size is not a positive integer.',
    );
  }
  if (page.pageSize > expectation.requestedPageSize) {
    return invalid(
      'PROVIDER_PAGE_SIZE_EXCEEDED',
      `Returned page size ${page.pageSize} exceeds the requested ${expectation.requestedPageSize}.`,
    );
  }

  // Total must be a non-negative integer.
  if (!Number.isInteger(page.total) || page.total < 0) {
    return invalid(
      'PROVIDER_TOTAL_INVALID',
      'Reported total is negative or not an integer.',
    );
  }

  // Total pages must be consistent with the reported total and page size.
  const expectedTotalPages = Math.max(
    1,
    Math.ceil(page.total / Math.max(page.pageSize, 1)),
  );

  if (
    !Number.isInteger(page.totalPages) ||
    page.totalPages !== expectedTotalPages
  ) {
    return invalid(
      'PROVIDER_TOTAL_PAGES_INVALID',
      `Total pages ${page.totalPages} is inconsistent with total ${page.total} at page size ${page.pageSize}.`,
    );
  }

  // The requested/returned page must lie inside the valid range for a
  // non-empty result set (page 1 of an empty set is the one valid empty read).
  if (page.total > 0 && page.pageNum > page.totalPages) {
    return invalid(
      'PROVIDER_PAGE_OUT_OF_RANGE',
      `Page ${page.pageNum} lies outside the valid 1..${page.totalPages} range.`,
    );
  }

  // Product count can never exceed the declared page size.
  if (page.products.length > page.pageSize) {
    return invalid(
      'PROVIDER_PAGE_OVERFLOW',
      `Page carries ${page.products.length} products but declares page size ${page.pageSize}.`,
    );
  }

  // An empty page while the metadata says records remain at this position.
  if (
    page.total > 0 &&
    page.pageNum <= page.totalPages &&
    page.products.length === 0
  ) {
    return invalid(
      'PROVIDER_EMPTY_PAGE_WITH_REMAINING_TOTAL',
      `Page ${page.pageNum} is empty while the provider reports total ${page.total}.`,
    );
  }

  // total=0 while content is non-empty.
  if (page.total === 0 && page.products.length > 0) {
    return invalid(
      'PROVIDER_ZERO_TOTAL_WITH_CONTENT',
      'Provider reported total 0 but returned products.',
    );
  }

  // Required product identity must be well-formed on every row.
  const malformed = page.products.find(
    (product) => typeof product.id !== 'string' || product.id.trim() === '',
  );

  if (malformed !== undefined) {
    return invalid(
      'PROVIDER_PRODUCT_IDENTITY_MALFORMED',
      'A returned product carries no usable provider product id.',
    );
  }

  return { ok: true };
}

/**
 * Second-stage check for a single-page (`total <= pageSize`) partition: the
 * set of valid unique PIDs must equal the reported total, or the partition
 * is inconsistent and must not be marked covered.
 */
export function validateSinglePageCompleteness(
  page: CatalogPage,
): PageValidationResult {
  const uniquePids = new Set(page.products.map((product) => product.id));

  if (uniquePids.size !== page.total) {
    return invalid(
      'PROVIDER_UNIQUE_COUNT_MISMATCH',
      `Unique PID count ${uniquePids.size} does not equal the reported total ${page.total}.`,
    );
  }

  return { ok: true };
}
