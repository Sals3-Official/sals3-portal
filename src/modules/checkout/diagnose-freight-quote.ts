import 'server-only';
import getDb, { type DbExecutor } from '@/lib/db/client';
import PostgresSupplierSecretStore from '@/lib/secrets/postgres-supplier-secret-store';
import createGovernedFetch from '@/modules/catalog/discovery/governed-fetch';
import CjTokenManager from '@/modules/suppliers/providers/cj/cj-auth';
import { CJ_BASE_URL } from '@/services/cj/config';
import {
  CheckoutFreightQuoteError,
  loadQuoteLines,
  quoteCheckoutFreight,
  type CheckoutFreightQuoteRequest,
  type QuoteLine,
} from './freight-quotes';

/**
 * Read-only, single-line diagnostic for "why does this product 503 on
 * freight-quotes" — the question `storefrontErrorResponse` exists to make
 * unanswerable from outside, on purpose (a driver message can carry a table
 * name or a connection string fragment). This tool is the sanctioned way to
 * ask it anyway: authenticated the same way every internal route is, and it
 * writes nothing.
 *
 * ## Why this duplicates `getCjJson`'s two calls instead of calling it
 *
 * `getCjJson` is deliberately narrow: on a non-2xx or a 429 it throws
 * `CjApiError` and discards the body, because the production checkout path
 * has nothing useful to do with CJ's raw text and must not leak it to a
 * buyer. That is exactly the information this tool exists to recover, so it
 * makes its own request against the same endpoint with the same token rather
 * than widening the production function's contract for a diagnostic path
 * nothing else should ever call.
 *
 * ## The two direct reads, then the real thing
 *
 * `loadQuoteLines`'s supplier-binding resolution is called directly, because
 * reproducing it here would be a second copy for it to drift from. The two CJ
 * reads that follow are inlined so their raw bodies are visible instead of
 * collapsed by `getCjJson`.
 *
 * If both of those come back clean — as they did the first time this tool
 * found nothing wrong with either — the failure is further in: the freight
 * calculation itself (`/logistic/freightCalculateTip`, a package-shaped
 * request the two product-level reads say nothing about) or the package
 * assembly around it. Rather than hand-build a third raw call, this step
 * calls the real, unmodified `quoteCheckoutFreight` with the caller's own
 * destination and reports whatever it throws — a `CheckoutFreightQuoteError`
 * has a buyer-facing message already; anything else is the actual defect this
 * tool exists to surface, named rather than swallowed into a 503.
 */
/**
 * What the real `quoteCheckoutFreight` did with the same product and
 * destination. `refusal` is a `CheckoutFreightQuoteError`'s own message — a
 * business answer, not a defect. `error` is everything else: the actual
 * unhandled exception `storefrontErrorResponse` would otherwise have
 * collapsed into a 503.
 */
export type FullQuoteOutcome =
  | { ok: true; quotes: unknown }
  | { ok: false; refusal: string }
  | { ok: false; error: { name: string; message: string } };

export type FreightQuoteDiagnosis =
  | {
      ok: true;
      line: {
        connectionId: string;
        externalProductId: string;
        externalVariantId: string;
        weightGrams: number | null;
        lengthMillimeters: number | null;
        widthMillimeters: number | null;
        heightMillimeters: number | null;
      };
      cjProductQuery: { status: number; body: unknown };
      cjInventoryQuery: { status: number; body: unknown };
      fullQuote: FullQuoteOutcome;
    }
  | {
      ok: false;
      step: 'load-quote-line' | 'cj-product-query' | 'cj-inventory-query';
      message: string;
    };

/**
 * A full, schema-shaped address for the `quoteCheckoutFreight` step, which
 * reads more of the address than `loadQuoteLines` does (only `.country`). CJ's
 * freight calculation prices on origin, destination country, weight and
 * volume — not street-level detail — so a placeholder is enough to exercise
 * the real call without needing a caller to supply a full address just to ask
 * "does this product quote at all".
 */
function placeholderAddress(
  country: string,
): CheckoutFreightQuoteRequest['address'] {
  return {
    email: 'diagnostic@sals3.com',
    fullName: 'Diagnostic Buyer',
    addressLine1: '1 Diagnostic Street',
    city: 'Diagnostic City',
    region: 'Diagnostic Region',
    postalCode: '0000',
    country: country as never,
  };
}

export async function diagnoseFreightQuote(
  input: {
    productSlug: string;
    variantId?: string;
    destinationCountry: string;
  },
  options: {
    executor?: DbExecutor;
    tokenManager?: CjTokenManager;
    fetcherForConnection?: (connectionId: string) => typeof fetch;
  } = {},
): Promise<FreightQuoteDiagnosis> {
  const executor = options.executor ?? getDb();
  const tokenManager =
    options.tokenManager ??
    new CjTokenManager(new PostgresSupplierSecretStore());
  const fetcherForConnection =
    options.fetcherForConnection ??
    ((connectionId: string) => createGovernedFetch(connectionId));

  let lines: QuoteLine[];

  try {
    lines = await loadQuoteLines(
      {
        cart: {
          items: [
            {
              productId: input.productSlug,
              variantId: input.variantId,
              quantity: 1,
            },
          ],
        },
        address: { country: input.destinationCountry } as never,
      } as never,
      executor,
    );
  } catch (error) {
    return {
      ok: false,
      step: 'load-quote-line',
      message:
        error instanceof CheckoutFreightQuoteError
          ? error.message
          : `Unexpected: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const line = lines[0];

  if (line === undefined) {
    return {
      ok: false,
      step: 'load-quote-line',
      message: 'No quote line resolved for this product and destination.',
    };
  }

  const fetcher = fetcherForConnection(line.connectionId);

  let token: string;

  try {
    token = await tokenManager.getAccessToken(line.connectionId);
  } catch (error) {
    return {
      ok: false,
      step: 'cj-product-query',
      message: `Could not obtain a CJ access token for this connection: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  let productResponse: Response;

  try {
    productResponse = await fetcher(
      `${CJ_BASE_URL}/product/query?pid=${encodeURIComponent(line.externalProductId)}`,
      { headers: { 'CJ-Access-Token': token }, cache: 'no-store' },
    );
  } catch (error) {
    return {
      ok: false,
      step: 'cj-product-query',
      message: `Request to CJ failed before a response arrived: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const productBody: unknown = await productResponse.json().catch((error) => ({
    parseError: error instanceof Error ? error.message : String(error),
  }));

  let inventoryResponse: Response;

  try {
    inventoryResponse = await fetcher(
      `${CJ_BASE_URL}/product/stock/getInventoryByPid?pid=${encodeURIComponent(line.externalProductId)}`,
      { headers: { 'CJ-Access-Token': token }, cache: 'no-store' },
    );
  } catch (error) {
    return {
      ok: false,
      step: 'cj-inventory-query',
      message: `Request to CJ failed before a response arrived: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const inventoryBody: unknown = await inventoryResponse
    .json()
    .catch((error) => ({
      parseError: error instanceof Error ? error.message : String(error),
    }));

  let fullQuote: FullQuoteOutcome;

  try {
    const quote = await quoteCheckoutFreight(
      {
        cart: {
          items: [
            {
              productId: input.productSlug,
              variantId: input.variantId,
              quantity: 1,
            },
          ],
        },
        address: placeholderAddress(input.destinationCountry),
      },
      { executor, fetcherForConnection, tokenManager },
    );

    fullQuote = { ok: true, quotes: quote.quotes };
  } catch (error) {
    fullQuote =
      error instanceof CheckoutFreightQuoteError
        ? { ok: false, refusal: error.message }
        : {
            ok: false,
            error: {
              name: error instanceof Error ? error.name : 'UnknownError',
              message: error instanceof Error ? error.message : String(error),
            },
          };
  }

  return {
    ok: true,
    line: {
      connectionId: line.connectionId,
      externalProductId: line.externalProductId,
      externalVariantId: line.externalVariantId,
      weightGrams: line.weightGrams,
      lengthMillimeters: line.lengthMillimeters,
      widthMillimeters: line.widthMillimeters,
      heightMillimeters: line.heightMillimeters,
    },
    cjProductQuery: { status: productResponse.status, body: productBody },
    cjInventoryQuery: { status: inventoryResponse.status, body: inventoryBody },
    fullQuote,
  };
}
