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
 * assembly around it.
 *
 * Two more steps answer that. `quoteCheckoutFreight` is called unmodified, so
 * a `CheckoutFreightQuoteError` (a buyer-facing refusal, not a defect) or
 * anything else it throws is visible by name. And because the harem-pants
 * investigation got exactly that — an unnamed `CjApiError` with no body,
 * because `getCjJson` discards one on a non-200 `code` the same way it does
 * for the first two reads — this also rebuilds the same
 * `/logistic/freightCalculateTip` request `freightBodyForPackage` would send
 * and POSTs it directly, so that raw body is visible too. It reads the
 * product/inventory bodies already fetched above rather than asking CJ a
 * third time (see `extractFreightInputs`), so this whole diagnosis costs
 * exactly one CJ call more than `quoteCheckoutFreight` alone already made.
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
      /**
       * Present only when `fullQuote` failed with something other than a
       * `CheckoutFreightQuoteError` — the raw `/logistic/freightCalculateTip`
       * response for the same package, which `getCjJson` would otherwise have
       * discarded on the way to that same failure.
       */
      cjFreightQuery?: { status: number; body: unknown };
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

  const address = placeholderAddress(input.destinationCountry);
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
        address,
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

  // Only when the real function failed unnamed — a refusal already explains
  // itself, and a success needs no second look at the same call.
  let cjFreightQuery: { status: number; body: unknown } | undefined;

  if (!fullQuote.ok && 'error' in fullQuote) {
    // eslint-disable-next-line no-use-before-define -- defined below, so the exported entry point reads first.
    cjFreightQuery = await diagnoseFreightCalculate({
      line,
      productBody,
      inventoryBody,
      address,
      fetcher,
      token,
    });
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
    ...(cjFreightQuery === undefined ? {} : { cjFreightQuery }),
  };
}

/** One entry of CJ's `/product/query` `data.variants[]`, read defensively. */
type CjRawVariant = {
  vid?: unknown;
  variantSku?: unknown;
  variantWeight?: unknown;
  variantLength?: unknown;
  variantWidth?: unknown;
  variantHeight?: unknown;
};

/**
 * Everything the freight-calculate request needs, read directly out of the
 * two response bodies this module already fetched — no third CJ round trip.
 *
 * The earlier version of this step called `loadPackageInputs` a second time to
 * get the same supplier-binding and origin resolution `quoteCheckoutFreight`
 * had just performed, which meant the product and inventory endpoints were
 * asked a **third** time in one diagnosis (once here directly, once inside
 * `quoteCheckoutFreight`, once inside this step). That is not free — every
 * quote through the same connection shares CJ's own points budget (ADR-013)
 * and the one-request-per-second governed-fetch limiter — and it made the
 * failure this step reported ambiguous: a `CjApiError` from a redundant third
 * read is indistinguishable from one raised by the freight-calculate call
 * this step exists to inspect.
 *
 * Reading the two bodies already in hand costs nothing further and removes
 * that ambiguity: whatever this step now reports is about the
 * freight-calculate request alone.
 */
function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function extractFreightInputs(
  line: QuoteLine,
  productBody: unknown,
  inventoryBody: unknown,
):
  | {
      sku: string;
      productProps: string[];
      originCountry: string;
      weight: number;
      volume: number;
    }
  | { error: string } {
  const variants = (
    productBody as { data?: { variants?: CjRawVariant[] } } | null
  )?.data?.variants;
  const variant = Array.isArray(variants)
    ? variants.find((candidate) => candidate.vid === line.externalVariantId)
    : undefined;

  if (variant === undefined) {
    return {
      error: `No variant matching ${line.externalVariantId} in the product-query response.`,
    };
  }

  const sku =
    line.externalSku ??
    (typeof variant.variantSku === 'string' ? variant.variantSku : undefined);

  if (sku === undefined || sku.trim() === '') {
    return { error: 'The matched variant has no usable SKU.' };
  }

  const productPropsRaw = (
    productBody as { data?: { productProEnSet?: unknown } } | null
  )?.data?.productProEnSet;
  const productProps = (
    Array.isArray(productPropsRaw) ? productPropsRaw : []
  ).filter(
    (prop): prop is string => typeof prop === 'string' && prop.trim() !== '',
  );

  if (productProps.length === 0) {
    return {
      error: 'The product-query response has no non-empty productProEnSet.',
    };
  }

  // Mirrors `requireDetailVariant`: the line's own frozen dimensions win, CJ's
  // variant-level numbers are the fallback.
  const weight = line.weightGrams ?? toFiniteNumber(variant.variantWeight);
  const length =
    line.lengthMillimeters ?? toFiniteNumber(variant.variantLength);
  const width = line.widthMillimeters ?? toFiniteNumber(variant.variantWidth);
  const height =
    line.heightMillimeters ?? toFiniteNumber(variant.variantHeight);

  if (weight === null || length === null || width === null || height === null) {
    return {
      error:
        'Missing package size or weight in both the line and the CJ variant.',
    };
  }

  const volume = (length / 10) * (width / 10) * (height / 10);

  const variantInventories = (
    inventoryBody as {
      data?: {
        variantInventories?: {
          vid?: unknown;
          inventory?: {
            countryCode?: unknown;
            cjInventory?: unknown;
            factoryInventory?: unknown;
            totalInventory?: unknown;
          }[];
        }[];
      };
    } | null
  )?.data?.variantInventories;
  const inventoryEntry = Array.isArray(variantInventories)
    ? variantInventories.find(
        (candidate) => candidate.vid === line.externalVariantId,
      )
    : undefined;
  const stocks = inventoryEntry?.inventory ?? [];
  // Mirrors `chooseOrigin`'s priority: CJ-owned stock first, then the
  // factory's, then any warehouse reporting stock at all.
  const cjStock = stocks.find((stock) => Number(stock.cjInventory ?? 0) > 0);
  const factoryStock = stocks.find(
    (stock) => Number(stock.factoryInventory ?? 0) > 0,
  );
  const anyStock = stocks.find(
    (stock) => Number(stock.totalInventory ?? 0) > 0,
  );
  const stocked = cjStock ?? factoryStock ?? anyStock;
  const originCountry =
    typeof stocked?.countryCode === 'string' ? stocked.countryCode : undefined;

  if (originCountry === undefined || originCountry === '') {
    return {
      error: 'No stocked warehouse for this variant in the inventory response.',
    };
  }

  return { sku, productProps, originCountry, weight, volume };
}

/**
 * Sends the same `/logistic/freightCalculateTip` request `freightBodyForPackage`
 * would for this one line, using only the product-query and inventory bodies
 * this module already fetched — see `extractFreightInputs` for why a third
 * call to CJ was removed rather than repeated. The request shape (`reqDTOS`,
 * the field names CJ expects) is still duplicated, because
 * `freightBodyForPackage` is not exported and building it inline for one line
 * is simpler than widening that function's contract for a caller nothing else
 * should ever be.
 */
async function diagnoseFreightCalculate(input: {
  line: QuoteLine;
  productBody: unknown;
  inventoryBody: unknown;
  address: CheckoutFreightQuoteRequest['address'];
  fetcher: typeof fetch;
  token: string;
}): Promise<{ status: number; body: unknown } | undefined> {
  const resolved = extractFreightInputs(
    input.line,
    input.productBody,
    input.inventoryBody,
  );

  if ('error' in resolved) {
    return {
      status: 0,
      body: { step: 'package-assembly', message: resolved.error },
    };
  }

  const { line } = input;
  const totalWeight = resolved.weight * line.quantity;
  const totalVolume = resolved.volume * line.quantity;

  const body = {
    reqDTOS: [
      {
        srcAreaCode: resolved.originCountry,
        destAreaCode: input.address.country,
        zip: input.address.postalCode,
        recipientAddress: input.address.addressLine1,
        recipientAddress1: input.address.addressLine1,
        recipientAddress2: input.address.addressLine2,
        city: input.address.city,
        province: input.address.region,
        recipientName: input.address.fullName,
        phone: input.address.phone,
        email: input.address.email,
        productProp: resolved.productProps,
        productTypes: ['0'],
        platforms: ['Shopify'],
        totalGoodsAmount: Number(
          ((Number(line.priceMinor) / 100) * line.quantity).toFixed(2),
        ),
        weight: Math.max(1, Math.round(totalWeight)),
        wrapWeight: Math.max(1, Math.round(totalWeight)),
        volume: Number(totalVolume.toFixed(2)),
        skuList: [resolved.sku],
        freightTrialSkuList: [
          {
            sku: resolved.sku,
            vid: line.externalVariantId,
            skuQuantity: line.quantity,
            skuWeight: resolved.weight,
            skuVolume: resolved.volume,
            productPropList: resolved.productProps,
            productTypeList: ['0'],
          },
        ],
      },
    ],
  };

  try {
    const response = await input.fetcher(
      `${CJ_BASE_URL}/logistic/freightCalculateTip`,
      {
        method: 'POST',
        headers: {
          'CJ-Access-Token': input.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        cache: 'no-store',
      },
    );
    const responseBody: unknown = await response.json().catch((error) => ({
      parseError: error instanceof Error ? error.message : String(error),
    }));

    return { status: response.status, body: responseBody };
  } catch (error) {
    return {
      status: 0,
      body: {
        step: 'freight-calculate-request',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
