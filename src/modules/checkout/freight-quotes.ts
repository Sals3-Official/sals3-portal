import 'server-only';

import { and, eq, isNotNull, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import getDb, { type DbExecutor } from '@/lib/db/client';
import {
  offerSupplierBindings,
  productOffers,
  productVariants,
  products,
  providerProductReferences,
  providerVariantReferences,
  supplierCandidates,
  supplierConnections,
  supplierProviders,
} from '@/lib/db/schema';
import {
  cjInventoryResponseSchema,
  cjProductDetailResponseSchema,
  type CjProductDetail,
  type CjVariantInventory,
} from '@/lib/cj/enrichment-schemas';
import PostgresSupplierSecretStore from '@/lib/secrets/postgres-supplier-secret-store';
import createGovernedFetch from '@/modules/catalog/discovery/governed-fetch';
import CjTokenManager from '@/modules/suppliers/providers/cj/cj-auth';
import { CJ_BASE_URL, CjApiError } from '@/services/cj/config';

const QUOTE_TTL_MS = 15 * 60 * 1000;
const CJ_REQUEST_TIMEOUT_MS = 8_000;

export const checkoutFreightAddressSchema = z.object({
  email: z.string().trim().email().max(254),
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(40).optional(),
  addressLine1: z.string().trim().min(4).max(120),
  addressLine2: z.string().trim().max(120).optional(),
  city: z.string().trim().min(2).max(80),
  region: z.string().trim().min(2).max(80),
  postalCode: z.string().trim().min(3).max(20),
  country: z.enum(['AU', 'PH']),
});

export const checkoutFreightCartLineSchema = z.object({
  productId: z.string().min(1).max(160),
  variantId: z.string().min(1).max(120).optional(),
  quantity: z.number().int().min(1).max(20),
});

export const checkoutFreightQuoteRequestSchema = z.object({
  cart: z.object({
    items: z.array(checkoutFreightCartLineSchema).min(1).max(50),
  }),
  address: checkoutFreightAddressSchema,
});

export type CheckoutFreightQuoteRequest = z.infer<
  typeof checkoutFreightQuoteRequestSchema
>;

export type CheckoutFreightQuote = {
  quoteId: string;
  packageId: string;
  label: 'Economy' | 'Standard' | 'Express' | 'Other';
  cjLogisticName: string;
  optionId: string;
  channelId: string;
  arrivalTime: string;
  amountMinor: number;
  currency: 'USD';
  originCountry: string;
  destinationCountry: string;
  ruleTips: string[];
  expiresAt: string;
};

export type CheckoutFreightQuoteResult = {
  quotes: CheckoutFreightQuote[];
  packages: { packageId: string; originCountry: string; itemCount: number }[];
  quotedAt: string;
};

export type QuoteLine = {
  slug: string;
  quantity: number;
  title: string;
  productId: string;
  variantId: string;
  priceMinor: bigint;
  connectionId: string;
  externalProductId: string;
  externalVariantId: string;
  externalSku: string | null;
  sals3Sku: string;
  /**
   * The supplier's own variant label, verbatim (`Black-1XL`) — the same string
   * the PDP's variant selector shows, so the order says what the buyer saw.
   * Frozen into the cart snapshot here and onto the order line at acceptance;
   * never joined live afterwards (ADR-007).
   */
  variantLabel: string | null;
  weightGrams: number | null;
  lengthMillimeters: number | null;
  widthMillimeters: number | null;
  heightMillimeters: number | null;
};

type OfferMatch = Omit<QuoteLine, 'quantity' | 'slug' | 'priceMinor'> & {
  slug: string | null;
  priceMinor: bigint | null;
  marketCode: string;
};

export type PackageInput = {
  packageId: string;
  connectionId: string;
  originCountry: string;
  destinationCountry: string;
  lines: QuoteLine[];
};

export type PackageInputs = {
  packages: PackageInput[];
  detailsByLine: Map<string, ReturnType<typeof requireDetailVariant>>;
};

const cjRuleTipSchema = z.object({
  msgEn: z.string().optional(),
  type: z.string().optional(),
});

const looseTextDefault = z.preprocess(
  (value) => (value === null || value === undefined ? '' : value),
  z.string(),
);
const looseRuleTips = z.preprocess(
  (value) => (Array.isArray(value) ? value : []),
  z.array(cjRuleTipSchema),
);
const looseNumberArray = z.preprocess(
  (value) => (Array.isArray(value) ? value : []),
  z.array(z.number()),
);

const cjFreightOptionSchema = z.object({
  arrivalTime: looseTextDefault,
  channelId: looseTextDefault,
  optionId: looseTextDefault,
  postage: z.coerce.number().nullable().optional(),
  wrapPostage: z.coerce.number().nullable().optional(),
  discountFee: z.coerce.number().nullable().optional(),
  taxesFee: z.coerce.number().nullable().optional(),
  clearanceOperationFee: z.coerce.number().nullable().optional(),
  tariff: z.coerce.number().nullable().optional(),
  totalPostageFee: z.coerce.number().nullable().optional(),
  error: looseTextDefault,
  errorEn: looseTextDefault,
  message: looseTextDefault,
  ruleTips: looseRuleTips,
  allRuleTips: looseRuleTips,
  option: z
    .object({
      enName: z.string().optional(),
      id: z.string().optional(),
      arrivalTime: z.string().optional(),
    })
    .nullable()
    .optional(),
  channel: z
    .object({
      enName: z.string().optional(),
      id: z.string().optional(),
    })
    .nullable()
    .optional(),
  recommendLogisticsTypeList: looseNumberArray,
});

const cjFreightResponseSchema = z.object({
  code: z.number(),
  result: z.boolean().optional(),
  data: z.array(cjFreightOptionSchema).nullable().optional(),
});

function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(CJ_REQUEST_TIMEOUT_MS);
}

function usdMinor(value: number): number {
  return Math.max(0, Math.round(value * 100));
}

function sumPositive(values: Array<number | null | undefined>): number {
  return values.reduce<number>((total, value) => {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return total;
    }

    return total + Math.max(0, value);
  }, 0);
}

function labelFor(
  arrivalTime: string,
  priceSort?: number[],
): CheckoutFreightQuote['label'] {
  if (priceSort?.includes(1)) return 'Economy';

  const firstDays = Number.parseInt(arrivalTime.split('-')[0] ?? '', 10);

  if (Number.isFinite(firstDays) && firstDays <= 7) return 'Express';
  if (Number.isFinite(firstDays) && firstDays <= 20) return 'Standard';

  return 'Other';
}

function variantVolumeCm3(line: QuoteLine): number | null {
  const { lengthMillimeters, widthMillimeters, heightMillimeters } = line;

  if (
    lengthMillimeters === null ||
    widthMillimeters === null ||
    heightMillimeters === null
  ) {
    return null;
  }

  return (
    (lengthMillimeters / 10) *
    (widthMillimeters / 10) *
    (heightMillimeters / 10)
  );
}

function chooseOfferForDestination(
  rows: OfferMatch[],
  destinationCountry: string,
): OfferMatch | undefined {
  const eligibleRows = rows.filter(
    (row): row is OfferMatch & { slug: string; priceMinor: bigint } =>
      row.slug !== null && row.priceMinor !== null,
  );
  const variantIds = new Set(eligibleRows.map((row) => row.variantId));

  if (variantIds.size !== 1) return undefined;

  return [...eligibleRows].sort((left, right) => {
    const leftMarketPriority = left.marketCode === destinationCountry ? 0 : 1;
    const rightMarketPriority = right.marketCode === destinationCountry ? 0 : 1;

    if (leftMarketPriority !== rightMarketPriority) {
      return leftMarketPriority - rightMarketPriority;
    }

    return Number(left.priceMinor - right.priceMinor);
  })[0];
}

async function postCjJson(
  connectionId: string,
  path: string,
  body: unknown,
  fetcher: typeof fetch,
  tokenManager: CjTokenManager,
): Promise<unknown> {
  const token = await tokenManager.getAccessToken(connectionId);
  let response: Response;

  try {
    response = await fetcher(`${CJ_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'CJ-Access-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: timeoutSignal(),
    });
  } catch {
    throw new CjApiError('upstream-unavailable');
  }

  if (response.status === 429) throw new CjApiError('rate-limited');
  if (!response.ok) throw new CjApiError('upstream-unavailable');

  return response.json();
}

async function getCjJson(
  connectionId: string,
  path: string,
  fetcher: typeof fetch,
  tokenManager: CjTokenManager,
): Promise<unknown> {
  const token = await tokenManager.getAccessToken(connectionId);
  let response: Response;

  try {
    response = await fetcher(`${CJ_BASE_URL}${path}`, {
      headers: { 'CJ-Access-Token': token },
      cache: 'no-store',
      signal: timeoutSignal(),
    });
  } catch {
    throw new CjApiError('upstream-unavailable');
  }

  if (response.status === 429) throw new CjApiError('rate-limited');
  if (!response.ok) throw new CjApiError('upstream-unavailable');

  return response.json();
}

export class CheckoutFreightQuoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckoutFreightQuoteError';
  }
}

export async function loadQuoteLines(
  input: CheckoutFreightQuoteRequest,
  executor: DbExecutor,
): Promise<QuoteLine[]> {
  const rows = await Promise.all(
    input.cart.items.map(async (line) => {
      const baseConditions: Array<SQL | undefined> = [
        eq(products.slug, line.productId),
        eq(products.publicationState, 'PUBLISHED'),
        isNotNull(products.publishedAt),
        line.variantId === undefined
          ? undefined
          : eq(productVariants.id, line.variantId),
        eq(productOffers.fulfillmentMode, 'SUPPLIER_DROPSHIP'),
        eq(productOffers.publishState, 'PUBLISHED'),
        eq(productOffers.pricingState, 'RESOLVED'),
        isNotNull(productOffers.priceAmountMinor),
        eq(productOffers.availabilityState, 'AVAILABLE'),
      ];
      const bindingConditions: Array<SQL | undefined> = [
        ...baseConditions,
        eq(offerSupplierBindings.state, 'ACTIVE'),
        eq(supplierProviders.code, 'CJ_DROPSHIPPING'),
        eq(supplierConnections.status, 'CONNECTED'),
      ];
      const query = executor
        .select({
          slug: products.slug,
          title: products.title,
          productId: products.id,
          variantId: productVariants.id,
          priceMinor: productOffers.priceAmountMinor,
          connectionId: offerSupplierBindings.supplierConnectionId,
          externalProductId: providerProductReferences.externalProductId,
          externalVariantId: providerVariantReferences.externalVariantId,
          externalSku: providerVariantReferences.externalSku,
          sals3Sku: productVariants.sals3Sku,
          variantLabel: providerVariantReferences.sourceOptionLabel,
          weightGrams: productVariants.weightGrams,
          lengthMillimeters: productVariants.lengthMillimeters,
          widthMillimeters: productVariants.widthMillimeters,
          heightMillimeters: productVariants.heightMillimeters,
          marketCode: productOffers.marketCode,
        })
        .from(products)
        .innerJoin(productVariants, eq(productVariants.productId, products.id))
        .innerJoin(
          productOffers,
          eq(productOffers.variantId, productVariants.id),
        )
        .innerJoin(
          offerSupplierBindings,
          eq(offerSupplierBindings.offerId, productOffers.id),
        )
        .innerJoin(
          providerVariantReferences,
          eq(
            providerVariantReferences.id,
            offerSupplierBindings.providerVariantReferenceId,
          ),
        )
        .innerJoin(
          providerProductReferences,
          eq(
            providerProductReferences.id,
            providerVariantReferences.providerProductReferenceId,
          ),
        )
        .innerJoin(
          supplierConnections,
          eq(
            supplierConnections.id,
            offerSupplierBindings.supplierConnectionId,
          ),
        )
        .innerJoin(
          supplierProviders,
          eq(supplierProviders.id, supplierConnections.providerId),
        )
        .where(and(...bindingConditions))
        .limit(20);
      const bindingRows = await query;
      const fallbackRows =
        bindingRows.length === 0
          ? await executor
              .select({
                slug: products.slug,
                title: products.title,
                productId: products.id,
                variantId: productVariants.id,
                priceMinor: productOffers.priceAmountMinor,
                connectionId: supplierCandidates.supplierConnectionId,
                externalProductId: providerProductReferences.externalProductId,
                externalVariantId: providerVariantReferences.externalVariantId,
                externalSku: providerVariantReferences.externalSku,
                sals3Sku: productVariants.sals3Sku,
                variantLabel: providerVariantReferences.sourceOptionLabel,
                weightGrams: productVariants.weightGrams,
                lengthMillimeters: productVariants.lengthMillimeters,
                widthMillimeters: productVariants.widthMillimeters,
                heightMillimeters: productVariants.heightMillimeters,
                marketCode: productOffers.marketCode,
              })
              .from(products)
              .innerJoin(
                productVariants,
                eq(productVariants.productId, products.id),
              )
              .innerJoin(
                productOffers,
                eq(productOffers.variantId, productVariants.id),
              )
              .innerJoin(
                providerVariantReferences,
                eq(providerVariantReferences.variantId, productVariants.id),
              )
              .innerJoin(
                providerProductReferences,
                eq(
                  providerProductReferences.id,
                  providerVariantReferences.providerProductReferenceId,
                ),
              )
              .innerJoin(
                supplierCandidates,
                eq(
                  supplierCandidates.id,
                  providerProductReferences.sourceCandidateId,
                ),
              )
              .innerJoin(
                supplierConnections,
                eq(
                  supplierConnections.id,
                  supplierCandidates.supplierConnectionId,
                ),
              )
              .innerJoin(
                supplierProviders,
                eq(supplierProviders.id, supplierConnections.providerId),
              )
              .where(
                and(
                  ...baseConditions,
                  eq(supplierProviders.code, 'CJ_DROPSHIPPING'),
                  eq(supplierConnections.status, 'CONNECTED'),
                ),
              )
              .limit(20)
          : [];
      const row = chooseOfferForDestination(
        bindingRows.length > 0 ? bindingRows : fallbackRows,
        input.address.country,
      );

      if (row === undefined || row.slug === null || row.priceMinor === null) {
        throw new CheckoutFreightQuoteError(
          'A cart item is not available for delivery to this address.',
        );
      }

      return {
        slug: row.slug,
        title: row.title,
        productId: row.productId,
        variantId: row.variantId,
        priceMinor: row.priceMinor,
        connectionId: row.connectionId,
        externalProductId: row.externalProductId,
        externalVariantId: row.externalVariantId,
        externalSku: row.externalSku,
        sals3Sku: row.sals3Sku,
        variantLabel: row.variantLabel,
        weightGrams: row.weightGrams,
        lengthMillimeters: row.lengthMillimeters,
        widthMillimeters: row.widthMillimeters,
        heightMillimeters: row.heightMillimeters,
        quantity: line.quantity,
      };
    }),
  );

  return rows;
}

function chooseOrigin(
  inventories: CjVariantInventory[],
  externalVariantId: string,
): string {
  const inventory = inventories.find((row) => row.vid === externalVariantId);
  const stocks = inventory?.inventory ?? [];
  const cjStock = stocks.find((stock) => (stock.cjInventory ?? 0) > 0);
  const factoryStock = stocks.find(
    (stock) => (stock.factoryInventory ?? 0) > 0,
  );
  const anyStock = stocks.find((stock) => (stock.totalInventory ?? 0) > 0);
  const origin = cjStock ?? factoryStock ?? anyStock;

  if (origin === undefined || origin.countryCode === '') {
    throw new CheckoutFreightQuoteError(
      'A cart item has no current stocked CJ origin.',
    );
  }

  return origin.countryCode;
}

function requireDetailVariant(detail: CjProductDetail, line: QuoteLine) {
  const variant = detail.variants.find(
    (candidate) => candidate.vid === line.externalVariantId,
  );
  const sku = line.externalSku ?? variant?.variantSku;
  const productProps = detail.productProEnSet.filter(
    (prop) => prop.trim() !== '',
  );

  if (variant === undefined || sku === undefined || sku.trim() === '') {
    throw new CheckoutFreightQuoteError(
      'A cart item is missing supplier variant details.',
    );
  }

  if (productProps.length === 0) {
    throw new CheckoutFreightQuoteError(
      'A cart item is missing CJ logistics properties.',
    );
  }

  const weight = line.weightGrams ?? variant.variantWeight;
  const length = line.lengthMillimeters ?? variant.variantLength;
  const width = line.widthMillimeters ?? variant.variantWidth;
  const height = line.heightMillimeters ?? variant.variantHeight;
  const volume = variantVolumeCm3({
    ...line,
    lengthMillimeters: length,
    widthMillimeters: width,
    heightMillimeters: height,
  });

  if (
    weight === null ||
    length === null ||
    width === null ||
    height === null ||
    volume === null
  ) {
    throw new CheckoutFreightQuoteError(
      'A cart item is missing package size or weight.',
    );
  }

  return { sku, productProps, weight, length, width, height, volume };
}

export async function loadPackageInputs(
  lines: QuoteLine[],
  destinationCountry: string,
  fetcherForConnection: (connectionId: string) => typeof fetch,
  tokenManager: CjTokenManager,
): Promise<PackageInputs> {
  const evidenceByProduct = new Map<
    string,
    {
      detail: CjProductDetail;
      inventories: CjVariantInventory[];
    }
  >();

  await Promise.all(
    Array.from(
      new Set(
        lines.map((line) => `${line.connectionId}:${line.externalProductId}`),
      ),
    ).map(async (key) => {
      const [connectionId, externalProductId] = key.split(':');

      if (connectionId === undefined || externalProductId === undefined) return;

      const fetcher = fetcherForConnection(connectionId);
      const detailParsed = cjProductDetailResponseSchema.safeParse(
        await getCjJson(
          connectionId,
          `/product/query?pid=${encodeURIComponent(externalProductId)}`,
          fetcher,
          tokenManager,
        ),
      );

      if (
        !detailParsed.success ||
        detailParsed.data.code !== 200 ||
        !detailParsed.data.data
      ) {
        throw new CjApiError('unexpected-response');
      }

      const inventoryParsed = cjInventoryResponseSchema.safeParse(
        await getCjJson(
          connectionId,
          `/product/stock/getInventoryByPid?pid=${encodeURIComponent(externalProductId)}`,
          fetcher,
          tokenManager,
        ),
      );

      if (!inventoryParsed.success || inventoryParsed.data.code !== 200) {
        throw new CjApiError('unexpected-response');
      }

      evidenceByProduct.set(key, {
        detail: detailParsed.data.data,
        inventories: inventoryParsed.data.data?.variantInventories ?? [],
      });
    }),
  );

  const packages = new Map<string, PackageInput>();
  const detailsByLine = new Map<
    string,
    ReturnType<typeof requireDetailVariant>
  >();

  lines.forEach((line) => {
    const evidence = evidenceByProduct.get(
      `${line.connectionId}:${line.externalProductId}`,
    );

    if (evidence === undefined) throw new CjApiError('unexpected-response');

    detailsByLine.set(
      line.variantId,
      requireDetailVariant(evidence.detail, line),
    );
    const originCountry = chooseOrigin(
      evidence.inventories,
      line.externalVariantId,
    );
    const packageKey = `${line.connectionId}:${originCountry}`;
    const existing = packages.get(packageKey) ?? {
      packageId: `pkg_${packages.size + 1}`,
      connectionId: line.connectionId,
      originCountry,
      destinationCountry,
      lines: [],
    };

    existing.lines.push(line);
    packages.set(packageKey, existing);
  });

  return { packages: [...packages.values()], detailsByLine };
}

function freightBodyForPackage(
  pkg: PackageInput,
  address: CheckoutFreightQuoteRequest['address'],
  detailsByLine: Map<string, ReturnType<typeof requireDetailVariant>>,
) {
  const first = pkg.lines[0];

  if (first === undefined) throw new CjApiError('unexpected-response');

  const productProps = detailsByLine.get(first.variantId)?.productProps ?? [
    'COMMON',
  ];
  const totalGoodsAmount = pkg.lines.reduce(
    (total, line) => total + (Number(line.priceMinor) / 100) * line.quantity,
    0,
  );
  const totalWeight = pkg.lines.reduce((total, line) => {
    const detail = detailsByLine.get(line.variantId);

    return total + (detail?.weight ?? 0) * line.quantity;
  }, 0);
  const totalVolume = pkg.lines.reduce((total, line) => {
    const detail = detailsByLine.get(line.variantId);

    return total + (detail?.volume ?? 0) * line.quantity;
  }, 0);

  return {
    reqDTOS: [
      {
        srcAreaCode: pkg.originCountry,
        destAreaCode: pkg.destinationCountry,
        zip: address.postalCode,
        recipientAddress: address.addressLine1,
        recipientAddress1: address.addressLine1,
        recipientAddress2: address.addressLine2,
        city: address.city,
        province: address.region,
        recipientName: address.fullName,
        phone: address.phone,
        email: address.email,
        productProp: productProps,
        productTypes: ['0'],
        platforms: ['Shopify'],
        totalGoodsAmount: Number(totalGoodsAmount.toFixed(2)),
        weight: Math.max(1, Math.round(totalWeight)),
        wrapWeight: Math.max(1, Math.round(totalWeight)),
        volume: Number(totalVolume.toFixed(2)),
        skuList: pkg.lines.map(
          (line) => detailsByLine.get(line.variantId)?.sku ?? line.sals3Sku,
        ),
        freightTrialSkuList: pkg.lines.map((line) => {
          const detail = detailsByLine.get(line.variantId);

          return {
            sku: detail?.sku ?? line.sals3Sku,
            vid: line.externalVariantId,
            skuQuantity: line.quantity,
            skuWeight: detail?.weight,
            skuVolume: detail?.volume,
            productPropList: detail?.productProps ?? productProps,
            productTypeList: ['0'],
          };
        }),
      },
    ],
  };
}

export async function quoteCheckoutFreight(
  input: CheckoutFreightQuoteRequest,
  options: {
    executor?: DbExecutor;
    fetcherForConnection?: (connectionId: string) => typeof fetch;
    tokenManager?: CjTokenManager;
  } = {},
): Promise<CheckoutFreightQuoteResult> {
  const quotedAt = new Date();
  const expiresAt = new Date(quotedAt.getTime() + QUOTE_TTL_MS).toISOString();
  const executor = options.executor ?? getDb();
  const tokenManager =
    options.tokenManager ??
    new CjTokenManager(new PostgresSupplierSecretStore());
  const fetcherForConnection =
    options.fetcherForConnection ??
    ((connectionId) => createGovernedFetch(connectionId));
  const lines = await loadQuoteLines(input, executor);
  const { packages, detailsByLine } = await loadPackageInputs(
    lines,
    input.address.country,
    fetcherForConnection,
    tokenManager,
  );

  const quotesByPackage = await Promise.all(
    packages.map(async (pkg) => {
      const parsed = cjFreightResponseSchema.safeParse(
        await postCjJson(
          pkg.connectionId,
          '/logistic/freightCalculateTip',
          freightBodyForPackage(pkg, input.address, detailsByLine),
          fetcherForConnection(pkg.connectionId),
          tokenManager,
        ),
      );

      if (!parsed.success || parsed.data.code !== 200) {
        throw new CjApiError('unexpected-response');
      }

      const rows = parsed.data.data ?? [];
      const rejectedRows = rows.filter(
        (row) => row.error !== '' || row.errorEn !== '',
      );

      if (rejectedRows.length > 0) {
        // eslint-disable-next-line no-console
        console.warn('[portal] CJ freight option rejected', {
          originCountry: pkg.originCountry,
          destinationCountry: pkg.destinationCountry,
          errors: rejectedRows.map((row) => row.errorEn || row.error),
        });
      }

      return rows
        .filter((row) => row.error === '' && row.errorEn === '')
        .map((row) => {
          const name =
            row.option?.enName ?? row.channel?.enName ?? 'CJ logistics';
          const optionId = row.optionId || row.option?.id || '';
          const channelId = row.channelId || row.channel?.id || '';
          const amount =
            row.totalPostageFee ??
            sumPositive([
              row.wrapPostage ?? row.discountFee ?? row.postage,
              row.taxesFee,
              row.clearanceOperationFee,
              row.tariff,
            ]);

          if (optionId === '' || channelId === '' || amount <= 0) return null;

          return {
            quoteId: crypto.randomUUID(),
            packageId: pkg.packageId,
            label: labelFor(
              row.arrivalTime || row.option?.arrivalTime || '',
              row.recommendLogisticsTypeList,
            ),
            cjLogisticName: name,
            optionId,
            channelId,
            arrivalTime: row.arrivalTime || row.option?.arrivalTime || '',
            amountMinor: usdMinor(amount),
            currency: 'USD' as const,
            originCountry: pkg.originCountry,
            destinationCountry: pkg.destinationCountry,
            ruleTips: [...row.ruleTips, ...row.allRuleTips]
              .map((tip) => tip.msgEn ?? tip.type ?? '')
              .filter((tip) => tip !== ''),
            expiresAt,
          };
        })
        .filter((quote): quote is CheckoutFreightQuote => quote !== null);
    }),
  );
  const quotes = quotesByPackage.flat();

  if (quotes.length === 0) {
    // eslint-disable-next-line no-console
    console.warn('[portal] CJ freight returned no usable options', {
      destinationCountry: input.address.country,
      packageCount: packages.length,
      packageOrigins: packages.map((pkg) => pkg.originCountry),
    });
    throw new CheckoutFreightQuoteError(
      'CJ returned no delivery methods for this cart and address.',
    );
  }

  return {
    quotes,
    packages: packages.map((pkg) => ({
      packageId: pkg.packageId,
      originCountry: pkg.originCountry,
      itemCount: pkg.lines.reduce((total, line) => total + line.quantity, 0),
    })),
    quotedAt: quotedAt.toISOString(),
  };
}
