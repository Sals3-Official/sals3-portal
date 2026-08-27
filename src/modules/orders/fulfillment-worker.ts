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
import createGovernedFetch from '@/modules/catalog/discovery/governed-fetch';
import type { FulfillOrderMessage } from '@/modules/catalog/discovery/messages';
import CjTokenManager from '@/modules/suppliers/providers/cj/cj-auth';
import { CJ_BASE_URL, CjApiError } from '@/services/cj/config';

const CJ_ORDER_TIMEOUT_MS = 10_000;

const cjResponseSchema = z.object({
  code: z.number(),
  result: z.boolean().optional(),
  success: z.boolean().optional(),
  message: z.string().optional(),
  data: z.unknown().optional(),
  requestId: z.string().optional(),
});

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

function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(CJ_ORDER_TIMEOUT_MS);
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function isSandboxOrderEnabled(): boolean {
  return process.env.CJ_ORDER_SANDBOX !== '0';
}

async function postCjJson(
  connectionId: string,
  path: string,
  body: unknown,
  tokenManager: CjTokenManager,
): Promise<unknown> {
  const token = await tokenManager.getAccessToken(connectionId);
  const fetcher = createGovernedFetch(connectionId);
  let response: Response;

  try {
    response = await fetcher(`${CJ_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'CJ-Access-Token': token,
        ...(path.endsWith('/createOrderV3') &&
        process.env.CJ_PLATFORM_TOKEN !== undefined
          ? { platformToken: process.env.CJ_PLATFORM_TOKEN }
          : {}),
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

  const parsed = cjResponseSchema.safeParse(await response.json());

  if (
    !parsed.success ||
    parsed.data.code !== 200 ||
    (parsed.data.result === false && parsed.data.success === false)
  ) {
    throw new CjApiError('unexpected-response');
  }

  return parsed.data;
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

    await executor
      .update(supplierOrderSteps)
      .set({
        status: 'FAILED',
        attempts: attempts + 1,
        errorCode: reason,
        updatedAt: new Date(),
      })
      .where(eq(supplierOrderSteps.idempotencyKey, input.idempotencyKey));

    throw error;
  }
}

function responseData(response: unknown): unknown {
  return cjResponseSchema.parse(response).data;
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

async function fulfillGroup(input: {
  orderNumber: string;
  group: Group;
  lines: Line[];
  address: z.infer<typeof addressSchema>;
  tokenManager: CjTokenManager;
}) {
  const db = getDb();
  const createRequest = createOrderBody(input);
  const createResponse = await runStep(db, {
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
      ),
  });
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
