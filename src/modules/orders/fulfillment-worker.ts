import 'server-only';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import cjShippingCountryName from '@/lib/cj/country-names';
import getDb, { type DbExecutor } from '@/lib/db/client';
import {
  checkoutIntents,
  fulfillmentGroups,
  sals3OrderLines,
  sals3Orders,
  supplierOrderSteps,
} from '@/lib/db/schema';
import PostgresSupplierSecretStore from '@/lib/secrets/postgres-supplier-secret-store';
import type { FulfillOrderMessage } from '@/modules/catalog/discovery/messages';
import CjTokenManager from '@/modules/suppliers/providers/cj/cj-auth';
import { CjApiError } from '@/services/cj/config';
import {
  cjEnvelopeSchema,
  getCjJson,
  postCjJson,
  type CjEnvelope,
} from './cj-http';

const createOrderDataSchema = z.object({
  orderId: z.string().min(1).nullish(),
  shipmentOrderId: z.string().min(1).nullish(),
});

const addCartConfirmDataSchema = z.object({
  shipmentsId: z.string().min(1).nullish(),
});

const parentOrderDataSchema = z.object({
  payId: z.string().min(1).nullish(),
});

const addressSchema = z.object({
  email: z.string().email(),
  fullName: z.string(),
  phone: z.string().optional(),
  addressLine1: z.string(),
  addressLine2: z.string().optional(),
  city: z.string(),
  region: z.string(),
  postalCode: z.string(),
  country: z.string(),
});

type CjStep =
  | 'CREATE_ORDER_V3'
  | 'ADD_CART'
  | 'ADD_CART_CONFIRM'
  | 'SAVE_GENERATE_PARENT_ORDER'
  | 'PAY_BALANCE_V2';

type Group = typeof fulfillmentGroups.$inferSelect;
/**
 * The line fields this worker sends to CJ, and only those.
 *
 * Deliberately not `typeof sals3OrderLines.$inferSelect` behind a bare
 * `.select()`. That pair expands to every column the Drizzle schema declares, so
 * adding a column to the schema immediately changes the SQL this worker
 * emits — and a deployment carrying a column production has not migrated yet
 * would fail every supplier order with `column ... does not exist`. Naming the
 * columns makes the query independent of the schema growing.
 */
type Line = {
  externalVariantId: string;
  externalSku: string | null;
  quantity: number;
  unitAmountMinor: bigint;
  storeLineItemId: string;
};

const LINE_COLUMNS = {
  externalVariantId: sals3OrderLines.externalVariantId,
  externalSku: sals3OrderLines.externalSku,
  quantity: sals3OrderLines.quantity,
  unitAmountMinor: sals3OrderLines.unitAmountMinor,
  storeLineItemId: sals3OrderLines.storeLineItemId,
} as const;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function isSandboxOrderEnabled(): boolean {
  return process.env.CJ_ORDER_SANDBOX !== '0';
}

/**
 * `platformToken` is an account-specific CJ field and only `createOrderV3`
 * takes it. Passed explicitly rather than inferred from the path, so
 * `cj-http.ts` stays a transport and knows nothing about which call is which.
 */
function createOrderHeaders(): Record<string, string> {
  const platformToken = process.env.CJ_PLATFORM_TOKEN;

  return platformToken === undefined ? {} : { platformToken };
}

/**
 * One structured line per failed supplier step.
 *
 * This worker logged nothing at all until 2026-08-28, which is why an order CJ
 * had actually created took a database console and a supplier API call to
 * explain. `detail` carries CJ's own code and message; nothing here carries the
 * address, email, or phone, which rule 35 forbids and which answer no question
 * this log exists for.
 */
function logSupplierFailure(
  scope: 'step' | 'group',
  context: { groupId: string; step?: CjStep },
  error: unknown,
): void {
  const cj = error instanceof CjApiError ? error : undefined;

  // eslint-disable-next-line no-console
  console.error('[portal] supplier fulfillment failed', {
    scope,
    groupId: context.groupId,
    ...(context.step === undefined ? {} : { step: context.step }),
    reason: cj?.reason ?? 'unexpected-response',
    ...(cj?.detail?.code === undefined ? {} : { cjCode: cj.detail.code }),
    ...(cj?.detail?.message === undefined
      ? {}
      : { cjMessage: cj.detail.message }),
  });
}

async function runStep(
  executor: DbExecutor,
  input: {
    groupId: string;
    step: CjStep;
    idempotencyKey: string;
    request: unknown;
    call: () => Promise<unknown>;
  },
): Promise<unknown> {
  const [existing] = await executor
    .select()
    .from(supplierOrderSteps)
    .where(
      and(
        eq(supplierOrderSteps.fulfillmentGroupId, input.groupId),
        eq(supplierOrderSteps.step, input.step),
      ),
    )
    .limit(1);

  if (existing?.status === 'SUCCEEDED') return existing.responseSnapshot;

  let stepId = existing?.id;
  const attempts = existing?.attempts ?? 0;

  if (existing === undefined) {
    const [created] = await executor
      .insert(supplierOrderSteps)
      .values({
        fulfillmentGroupId: input.groupId,
        step: input.step,
        idempotencyKey: input.idempotencyKey,
        requestSnapshot: input.request,
      })
      .returning({ id: supplierOrderSteps.id });

    if (created === undefined) throw new CjApiError('unexpected-response');
    stepId = created.id;
  }

  if (stepId === undefined) throw new CjApiError('unexpected-response');

  try {
    const response = await input.call();

    await executor
      .update(supplierOrderSteps)
      .set({
        status: 'SUCCEEDED',
        responseSnapshot: response,
        attempts: attempts + 1,
        errorCode: null,
        updatedAt: new Date(),
      })
      .where(eq(supplierOrderSteps.id, stepId));

    return response;
  } catch (error) {
    const reason =
      error instanceof CjApiError ? error.reason : 'unexpected-response';
    const detail = error instanceof CjApiError ? error.detail : undefined;

    logSupplierFailure(
      'step',
      { groupId: input.groupId, step: input.step },
      error,
    );

    await executor
      .update(supplierOrderSteps)
      .set({
        status: 'FAILED',
        attempts: attempts + 1,
        errorCode: reason,
        // The five reason codes cannot tell a refused order from a refused
        // variant. CJ's own words can, and this column is already nullable
        // jsonb, so keeping them costs no migration and no schema change.
        ...(detail === undefined ? {} : { responseSnapshot: detail }),
        updatedAt: new Date(),
      })
      .where(eq(supplierOrderSteps.idempotencyKey, input.idempotencyKey));

    throw error;
  }
}

function responseData(response: unknown): unknown {
  return cjEnvelopeSchema.parse(response).data;
}

function moneyDecimal(minor: bigint): number {
  return Number(minor) / 100;
}

function createOrderBody(input: {
  orderNumber: string;
  group: Group;
  address: z.infer<typeof addressSchema>;
  lines: Line[];
}) {
  return {
    orderNumber: `${input.orderNumber}-${input.group.packageId}`,
    shippingZip: input.address.postalCode,
    /**
     * Two fields, two formats. CJ documents `shippingCountry` as the
     * destination country and `shippingCountryCode` as its two-letter code;
     * `addressSnapshot.country` is the code, so only the second one may take it
     * raw. See `cjShippingCountryName` for CJ's own spelling of each name.
     */
    shippingCountry: cjShippingCountryName(input.address.country),
    shippingCountryCode: input.address.country,
    shippingProvince: input.address.region,
    shippingCity: input.address.city,
    shippingPhone: input.address.phone ?? '',
    shippingCustomerName: input.address.fullName,
    shippingAddress: input.address.addressLine1,
    shippingAddress2: input.address.addressLine2 ?? '',
    email: input.address.email,
    logisticName: input.group.logisticName,
    fromCountryCode: input.group.originCountry,
    platform: 'api',
    ...(process.env.CJ_ORDER_STORE_NAME === undefined
      ? {}
      : { storeName: process.env.CJ_ORDER_STORE_NAME }),
    isSandbox: isSandboxOrderEnabled() ? 1 : 0,
    shopLogisticsType: envInt('CJ_ORDER_SHOP_LOGISTICS_TYPE', 2),
    orderFlow: 1,
    products: input.lines.map((line) => ({
      vid: line.externalVariantId,
      ...(line.externalSku === null ? {} : { sku: line.externalSku }),
      quantity: line.quantity,
      unitPrice: moneyDecimal(line.unitAmountMinor),
      storeLineItemId: line.storeLineItemId,
    })),
  };
}

/**
 * `/shopping/order/getOrderDetail` answering about an order we may have
 * orphaned. Only `orderId` is read; CJ's payload is far wider and drifts.
 *
 * Deliberately not `orderDetailSchema` from `status-sync.ts`: that one reads
 * the shipping fields and never looks at `orderId`, and widening it to serve
 * both would couple a status read to an order-creation recovery.
 */
const recoveredOrderSchema = z.object({
  orderId: z.union([z.string(), z.number()]).nullish(),
});

/**
 * Whether CJ said "no such order" rather than "something went wrong".
 *
 * Both arrive as `unexpected-response`, and telling them apart matters more
 * here than anywhere else in this file: read it as not-found when CJ actually
 * failed and the next line creates a second supplier order for a buyer who
 * ordered once. So this matches CJ's own words and everything else falls
 * through to a rethrow — a stuck retry is recoverable, a duplicate order is
 * money.
 */
function isOrderNotFound(error: unknown): boolean {
  return (
    error instanceof CjApiError &&
    /not\s*found/i.test(error.detail?.message ?? '')
  );
}

/**
 * Recovers a supplier order CJ created but this worker never learned the id of.
 *
 * The failure this exists for, from 2026-08-28: `createOrderV3` was abandoned
 * at the client timeout, CJ completed the write anyway, and the group was left
 * `FULFILLMENT_FAILED` with a null `cj_order_id`. Every replay then re-sent the
 * same deterministic `orderNumber`, which CJ refused as a duplicate, so the
 * order could never move and never self-heal — `status-sync` skips groups
 * whose `cj_order_id` is null, by design.
 *
 * `orderNumber` is `${order.orderNumber}-${group.packageId}`, stable across
 * every attempt, which makes it an idempotency key on CJ's side. Asking CJ
 * about it before creating turns the timeout from a lost order into a slow one.
 *
 * Scoped to a **previously failed** create on purpose. A group with no step row
 * has never called CJ, so there is nothing to adopt and the lookup would be a
 * wasted call on every first attempt; a `SUCCEEDED` row is already served from
 * `runStep`'s own cache. Returning `null` means "create it".
 */
async function adoptOrphanedCjOrder(
  executor: DbExecutor,
  input: { group: Group; tokenManager: CjTokenManager },
  orderNumber: string,
): Promise<{ envelope: CjEnvelope } | null> {
  const [existing] = await executor
    .select()
    .from(supplierOrderSteps)
    .where(
      and(
        eq(supplierOrderSteps.fulfillmentGroupId, input.group.id),
        eq(supplierOrderSteps.step, 'CREATE_ORDER_V3'),
      ),
    )
    .limit(1);

  if (existing === undefined || existing.status !== 'FAILED') return null;

  let detailRaw: unknown;

  try {
    detailRaw = await getCjJson(
      input.group.supplierConnectionId,
      `/shopping/order/getOrderDetail?orderId=${encodeURIComponent(orderNumber)}`,
      input.tokenManager,
    );
  } catch (error) {
    if (isOrderNotFound(error)) return null;

    throw error;
  }

  const orderId = recoveredOrderSchema.parse(detailRaw ?? {}).orderId ?? null;

  if (orderId === null) return null;

  const envelope: CjEnvelope = {
    code: 200,
    data: { orderId: String(orderId) },
  };

  // eslint-disable-next-line no-console
  console.error('[portal] adopted an orphaned CJ order', {
    groupId: input.group.id,
    orderNumber,
  });

  await executor
    .update(supplierOrderSteps)
    .set({
      status: 'SUCCEEDED',
      responseSnapshot: envelope,
      attempts: existing.attempts + 1,
      errorCode: null,
      updatedAt: new Date(),
    })
    .where(eq(supplierOrderSteps.id, existing.id));

  return { envelope };
}

async function fulfillGroup(input: {
  orderNumber: string;
  group: Group;
  lines: Line[];
  address: z.infer<typeof addressSchema>;
  tokenManager: CjTokenManager;
}) {
  const db = getDb();
  const createRequest = createOrderBody(input);
  const adopted = await adoptOrphanedCjOrder(
    db,
    input,
    createRequest.orderNumber,
  );
  const createResponse =
    adopted === null
      ? await runStep(db, {
          groupId: input.group.id,
          step: 'CREATE_ORDER_V3',
          idempotencyKey: `cj:create:${input.group.id}`,
          request: createRequest,
          call: () =>
            postCjJson(
              input.group.supplierConnectionId,
              '/shopping/order/createOrderV3',
              createRequest,
              input.tokenManager,
              { headers: createOrderHeaders() },
            ),
        })
      : adopted.envelope;
  const createData = createOrderDataSchema.parse(responseData(createResponse));
  const cjOrderId = createData.orderId ?? createData.shipmentOrderId;

  if (cjOrderId == null) throw new CjApiError('unexpected-response');

  await db
    .update(fulfillmentGroups)
    .set({
      cjOrderId,
      cjShipmentOrderId: createData.shipmentOrderId ?? null,
      status: 'CJ_ORDER_CREATED',
      updatedAt: new Date(),
    })
    .where(eq(fulfillmentGroups.id, input.group.id));

  const cartRequest = { cjOrderIdList: [cjOrderId] };
  await runStep(db, {
    groupId: input.group.id,
    step: 'ADD_CART',
    idempotencyKey: `cj:add-cart:${input.group.id}`,
    request: cartRequest,
    call: () =>
      postCjJson(
        input.group.supplierConnectionId,
        '/shopping/order/addCart',
        cartRequest,
        input.tokenManager,
      ),
  });

  const confirmResponse = await runStep(db, {
    groupId: input.group.id,
    step: 'ADD_CART_CONFIRM',
    idempotencyKey: `cj:add-cart-confirm:${input.group.id}`,
    request: cartRequest,
    call: () =>
      postCjJson(
        input.group.supplierConnectionId,
        '/shopping/order/addCartConfirm',
        cartRequest,
        input.tokenManager,
      ),
  });
  const confirmData = addCartConfirmDataSchema.parse(
    responseData(confirmResponse),
  );
  const shipmentOrderId =
    confirmData.shipmentsId ?? createData.shipmentOrderId ?? cjOrderId;

  await db
    .update(fulfillmentGroups)
    .set({
      cjShipmentOrderId: shipmentOrderId,
      status: 'CJ_CART_CONFIRMED',
      updatedAt: new Date(),
    })
    .where(eq(fulfillmentGroups.id, input.group.id));

  const parentRequest = { shipmentOrderId };
  const parentResponse = await runStep(db, {
    groupId: input.group.id,
    step: 'SAVE_GENERATE_PARENT_ORDER',
    idempotencyKey: `cj:parent:${input.group.id}`,
    request: parentRequest,
    call: () =>
      postCjJson(
        input.group.supplierConnectionId,
        '/shopping/order/saveGenerateParentOrder',
        parentRequest,
        input.tokenManager,
      ),
  });
  const parentData = parentOrderDataSchema.parse(responseData(parentResponse));

  await db
    .update(fulfillmentGroups)
    .set({
      cjPayId: parentData.payId ?? null,
      status: 'CJ_PARENT_ORDER_CREATED',
      updatedAt: new Date(),
    })
    .where(eq(fulfillmentGroups.id, input.group.id));

  const payRequest = {
    shipmentOrderId,
    ...(parentData.payId == null ? {} : { payId: parentData.payId }),
  };

  try {
    await runStep(db, {
      groupId: input.group.id,
      step: 'PAY_BALANCE_V2',
      idempotencyKey: `cj:pay:${input.group.id}`,
      request: payRequest,
      call: () =>
        postCjJson(
          input.group.supplierConnectionId,
          '/shopping/pay/payBalanceV2',
          payRequest,
          input.tokenManager,
        ),
    });
  } catch (error) {
    await db
      .update(fulfillmentGroups)
      .set({
        status: 'AWAITING_SUPPLIER_FUNDS',
        lastErrorCode:
          error instanceof CjApiError ? error.reason : 'unexpected-response',
        updatedAt: new Date(),
      })
      .where(eq(fulfillmentGroups.id, input.group.id));
    return;
  }

  await db
    .update(fulfillmentGroups)
    .set({ status: 'CJ_PAID', lastErrorCode: null, updatedAt: new Date() })
    .where(eq(fulfillmentGroups.id, input.group.id));
}

export default async function handleFulfillOrder(
  message: FulfillOrderMessage,
): Promise<void> {
  const db = getDb();
  const [order] = await db
    .select({
      id: sals3Orders.id,
      orderNumber: sals3Orders.orderNumber,
      addressSnapshot: checkoutIntents.addressSnapshot,
    })
    .from(sals3Orders)
    .innerJoin(
      checkoutIntents,
      eq(checkoutIntents.id, sals3Orders.checkoutIntentId),
    )
    .where(eq(sals3Orders.id, message.orderId))
    .limit(1);

  if (order === undefined) return;

  const address = addressSchema.parse(order.addressSnapshot);
  const groups = await db
    .select()
    .from(fulfillmentGroups)
    .where(eq(fulfillmentGroups.orderId, order.id));
  const tokenManager = new CjTokenManager(new PostgresSupplierSecretStore());

  /* eslint-disable no-await-in-loop -- CJ order groups must execute sequentially to avoid replay-driven wallet double-charges. */
  // eslint-disable-next-line no-restricted-syntax -- sequential supplier payment chain.
  for (const group of groups) {
    if (group.status !== 'CJ_PAID') {
      const lines = await db
        .select(LINE_COLUMNS)
        .from(sals3OrderLines)
        .where(eq(sals3OrderLines.fulfillmentGroupId, group.id));

      try {
        await fulfillGroup({
          orderNumber: order.orderNumber,
          group,
          lines,
          address,
          tokenManager,
        });
      } catch (error) {
        logSupplierFailure('group', { groupId: group.id }, error);

        await db
          .update(fulfillmentGroups)
          .set({
            status: 'FULFILLMENT_FAILED',
            lastErrorCode:
              error instanceof CjApiError
                ? error.reason
                : 'unexpected-response',
            updatedAt: new Date(),
          })
          .where(eq(fulfillmentGroups.id, group.id));
        throw error;
      }
    }
  }
  /* eslint-enable no-await-in-loop */
}
