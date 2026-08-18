import 'server-only';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import getDb, { type Database, type DbExecutor } from '@/lib/db/client';
import {
  checkoutIntents,
  fulfillmentGroups,
  sals3OrderLines,
  sals3Orders,
  type CheckoutIntentRow,
} from '@/lib/db/schema';
import { insertOutboxIntents } from '@/modules/catalog/discovery/outbox-repository';
import PostgresSupplierSecretStore from '@/lib/secrets/postgres-supplier-secret-store';
import CjTokenManager from '@/modules/suppliers/providers/cj/cj-auth';
import createGovernedFetch from '@/modules/catalog/discovery/governed-fetch';
import {
  checkoutFreightQuoteRequestSchema,
  loadPackageInputs,
  loadQuoteLines,
  quoteCheckoutFreight,
  type CheckoutFreightQuoteResult,
  type PackageInput,
  type QuoteLine,
} from './freight-quotes';

const shippingSelectionSchema = z.object({
  packageSelections: z
    .array(
      z.object({
        packageId: z.string().min(1).max(80),
        quoteId: z.string().min(1).max(120),
        optionId: z.string().min(1).max(120),
        channelId: z.string().min(1).max(120),
        cjLogisticName: z.string().min(1).max(120),
        arrivalTime: z.string().min(1).max(80),
        amountMinor: z.number().int().nonnegative(),
        currency: z.enum(['USD']),
      }),
    )
    .min(1)
    .max(20),
});

export const createCheckoutIntentSchema =
  checkoutFreightQuoteRequestSchema.extend({
    shippingSelection: shippingSelectionSchema,
  });

export const acceptCheckoutOrderSchema = z.object({
  checkoutIntentId: z.uuid(),
  stripeEventId: z.string().min(1).max(200),
  stripeCheckoutSessionId: z.string().min(1).max(200),
  stripePaymentIntentId: z.string().min(1).max(200).optional(),
  amountTotalMinor: z.number().int().nonnegative(),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase()),
  customerEmail: z.string().trim().email().max(254).optional(),
});

export type CreateCheckoutIntentInput = z.infer<
  typeof createCheckoutIntentSchema
>;
export type AcceptCheckoutOrderInput = z.infer<
  typeof acceptCheckoutOrderSchema
>;

export class CheckoutOrderError extends Error {
  readonly status: number;

  constructor(message: string, status = 422) {
    super(message);
    this.name = 'CheckoutOrderError';
    this.status = status;
  }
}

function selectionTotal(input: CreateCheckoutIntentInput): number {
  return input.shippingSelection.packageSelections.reduce(
    (total, row) => total + row.amountMinor,
    0,
  );
}

function validateSelection(
  quote: CheckoutFreightQuoteResult,
  input: CreateCheckoutIntentInput,
) {
  const selected = input.shippingSelection.packageSelections.map(
    (selection) => {
      const match = quote.quotes.find(
        (candidate) =>
          candidate.packageId === selection.packageId &&
          candidate.optionId === selection.optionId &&
          candidate.channelId === selection.channelId &&
          candidate.amountMinor === selection.amountMinor,
      );

      if (match === undefined) {
        throw new CheckoutOrderError(
          'Shipping changed. Refresh delivery options and choose again.',
        );
      }

      return match;
    },
  );

  if (
    new Set(selected.map((row) => row.packageId)).size !== quote.packages.length
  ) {
    throw new CheckoutOrderError('Choose a delivery option for every package.');
  }

  if (selectionTotal(input) <= 0) {
    throw new CheckoutOrderError('Choose a delivery option.');
  }

  return selected;
}

function lineStoreId(line: QuoteLine): string {
  return `${line.productId}:${line.variantId}`;
}

function groupForLine(packages: PackageInput[], line: QuoteLine): PackageInput {
  const match = packages.find(
    (pkg) =>
      pkg.connectionId === line.connectionId &&
      pkg.lines.some((candidate) => candidate.variantId === line.variantId),
  );

  if (match === undefined) {
    throw new CheckoutOrderError('A cart item cannot be assigned to delivery.');
  }

  return match;
}

function makeOrderNumber(now = new Date()): string {
  const date = now.toISOString().slice(0, 10).replaceAll('-', '');
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  const suffix = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');

  return `S3-${date}-${suffix.toUpperCase()}`;
}

export async function createCheckoutIntent(
  input: CreateCheckoutIntentInput,
  options: { executor?: DbExecutor } = {},
): Promise<{ checkoutIntentId: string }> {
  const executor = options.executor ?? getDb();
  const quote = await quoteCheckoutFreight(input, { executor });
  const selected = validateSelection(quote, input);
  const lines = await loadQuoteLines(input, executor);
  const tokenManager = new CjTokenManager(new PostgresSupplierSecretStore());
  const { packages } = await loadPackageInputs(
    lines,
    input.address.country,
    (connectionId) => createGovernedFetch(connectionId),
    tokenManager,
  );
  const lineSnapshots = lines.map((line) => {
    const group = groupForLine(packages, line);

    return {
      ...line,
      storeLineItemId: lineStoreId(line),
      packageId: group.packageId,
      priceMinor: Number(line.priceMinor),
    };
  });
  const subtotal = lineSnapshots.reduce(
    (total, line) => total + line.priceMinor * line.quantity,
    0,
  );
  const total = subtotal + selectionTotal(input);
  const [row] = await executor
    .insert(checkoutIntents)
    .values({
      buyerEmail: input.address.email,
      amountMinor: BigInt(total),
      currency: 'USD',
      cartSnapshot: { lines: lineSnapshots },
      addressSnapshot: input.address,
      freightSnapshot: { ...quote, selected },
      shippingSelectionSnapshot: input.shippingSelection,
    })
    .returning({ id: checkoutIntents.id });

  if (row === undefined) {
    throw new CheckoutOrderError('Checkout intent could not be created.', 500);
  }

  return { checkoutIntentId: row.id };
}

function snapshotLines(
  intent: CheckoutIntentRow,
): Array<
  Omit<typeof sals3OrderLines.$inferInsert, 'orderId' | 'fulfillmentGroupId'>
> {
  const parsed = z
    .object({
      lines: z.array(
        z.object({
          storeLineItemId: z.string(),
          productId: z.uuid(),
          variantId: z.uuid(),
          title: z.string(),
          quantity: z.number().int().positive(),
          priceMinor: z.number().int().nonnegative(),
          connectionId: z.uuid(),
          externalProductId: z.string(),
          externalVariantId: z.string(),
          externalSku: z.string().nullable(),
          sals3Sku: z.string(),
          packageId: z.string(),
        }),
      ),
    })
    .parse(intent.cartSnapshot);

  return parsed.lines.map((line) => ({
    storeLineItemId: line.storeLineItemId,
    productId: line.productId,
    variantId: line.variantId,
    title: line.title,
    quantity: line.quantity,
    unitAmountMinor: BigInt(line.priceMinor),
    currency: intent.currency,
    supplierConnectionId: line.connectionId,
    externalProductId: line.externalProductId,
    externalVariantId: line.externalVariantId,
    externalSku: line.externalSku,
    sals3Sku: line.sals3Sku,
  }));
}

function selectedFreight(intent: CheckoutIntentRow) {
  return z
    .object({
      selected: z.array(
        z.object({
          packageId: z.string(),
          cjLogisticName: z.string(),
          optionId: z.string(),
          channelId: z.string(),
          amountMinor: z.number().int().nonnegative(),
          currency: z.literal('USD'),
          originCountry: z.string(),
          destinationCountry: z.string(),
        }),
      ),
    })
    .parse(intent.freightSnapshot).selected;
}

function addressEmail(intent: CheckoutIntentRow): string {
  return z.object({ email: z.string().email() }).parse(intent.addressSnapshot)
    .email;
}

export async function acceptCheckoutOrder(
  input: AcceptCheckoutOrderInput,
  options: { db?: Database } = {},
): Promise<{ orderId: string; orderNumber: string }> {
  const db = options.db ?? getDb();

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: sals3Orders.id,
        orderNumber: sals3Orders.orderNumber,
      })
      .from(sals3Orders)
      .where(
        eq(sals3Orders.stripeCheckoutSessionId, input.stripeCheckoutSessionId),
      )
      .limit(1);

    if (existing !== undefined) {
      return { orderId: existing.id, orderNumber: existing.orderNumber };
    }

    const [intent] = await tx
      .select()
      .from(checkoutIntents)
      .where(eq(checkoutIntents.id, input.checkoutIntentId))
      .limit(1);

    if (intent === undefined) {
      throw new CheckoutOrderError('Checkout intent was not found.', 404);
    }
    if (intent.status !== 'PENDING') {
      throw new CheckoutOrderError('Checkout intent is no longer pending.');
    }
    if (
      intent.amountMinor !== BigInt(input.amountTotalMinor) ||
      intent.currency !== input.currency
    ) {
      throw new CheckoutOrderError(
        'Stripe amount does not match checkout intent.',
      );
    }

    const orderNumber = makeOrderNumber();
    const [order] = await tx
      .insert(sals3Orders)
      .values({
        orderNumber,
        checkoutIntentId: intent.id,
        stripeCheckoutSessionId: input.stripeCheckoutSessionId,
        stripePaymentIntentId: input.stripePaymentIntentId,
        buyerEmail: input.customerEmail ?? addressEmail(intent),
        amountMinor: intent.amountMinor,
        currency: intent.currency,
      })
      .returning({ id: sals3Orders.id, orderNumber: sals3Orders.orderNumber });

    if (order === undefined) {
      throw new CheckoutOrderError('Order could not be created.', 500);
    }

    const freight = selectedFreight(intent);
    const groups = await tx
      .insert(fulfillmentGroups)
      .values(
        freight.map((row) => {
          const line = z
            .object({
              lines: z.array(
                z.object({
                  packageId: z.string(),
                  connectionId: z.uuid(),
                }),
              ),
            })
            .parse(intent.cartSnapshot)
            .lines.find((candidate) => candidate.packageId === row.packageId);

          if (line === undefined) {
            throw new CheckoutOrderError(
              'Fulfillment group has no order line.',
            );
          }

          return {
            orderId: order.id,
            packageId: row.packageId,
            supplierConnectionId: line.connectionId,
            originCountry: row.originCountry,
            destinationCountry: row.destinationCountry,
            logisticName: row.cjLogisticName,
            optionId: row.optionId,
            channelId: row.channelId,
            shippingAmountMinor: BigInt(row.amountMinor),
            currency: row.currency,
          };
        }),
      )
      .returning({
        id: fulfillmentGroups.id,
        packageId: fulfillmentGroups.packageId,
      });

    const groupByPackage = new Map(
      groups.map((row) => [row.packageId, row.id]),
    );
    const lineSnapshots = z
      .object({
        lines: z.array(z.object({ packageId: z.string() }).passthrough()),
      })
      .parse(intent.cartSnapshot).lines;
    const lines = snapshotLines(intent).map((line, index) => {
      const fulfillmentGroupId = groupByPackage.get(
        String(lineSnapshots[index]?.packageId),
      );

      if (fulfillmentGroupId === undefined) {
        throw new CheckoutOrderError('Order line has no fulfillment group.');
      }

      return {
        ...line,
        orderId: order.id,
        fulfillmentGroupId,
      };
    });

    await tx.insert(sals3OrderLines).values(lines);
    await tx
      .update(checkoutIntents)
      .set({
        status: 'ACCEPTED',
        stripeCheckoutSessionId: input.stripeCheckoutSessionId,
        stripePaymentIntentId: input.stripePaymentIntentId,
        stripeEventId: input.stripeEventId,
        acceptedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(checkoutIntents.id, intent.id),
          eq(checkoutIntents.status, 'PENDING'),
        ),
      );

    await insertOutboxIntents(tx, [
      {
        message: {
          v: 1,
          operation: 'FULFILL_ORDER',
          idempotencyKey: `fulfill-order:${order.id}`,
          orderId: order.id,
        },
      },
    ]);

    return { orderId: order.id, orderNumber: order.orderNumber };
  });
}
