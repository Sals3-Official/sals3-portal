import { ownsProduct, requirePermission } from '@/lib/auth/session';
import { PermissionError } from '@/lib/auth/permissions';
import { auditEntry, todayIso } from '@/lib/products/audit';
import { queryProducts } from '@/lib/products/query';
import {
  isTransitionAllowed,
  TRANSITION_RULES,
  type StatusTransition,
} from '@/lib/products/status-workflow';
import type {
  Product,
  ProductInput,
  ProductListQuery,
  ProductListResult,
} from '@/lib/products/types';
import * as store from './product-store';

/**
 * Authorized catalogue operations.
 *
 * Every exported function starts with a permission check and, for writes,
 * an ownership check. Components never reach `product-store` directly.
 */

export async function listProducts(
  query: ProductListQuery,
): Promise<ProductListResult> {
  const session = await requirePermission('product:read');
  const visible = store
    .readAll()
    .filter((product) => ownsProduct(session, product.sellerId));

  return queryProducts(visible, query);
}

export async function getProduct(id: string): Promise<Product | null> {
  const session = await requirePermission('product:read');
  const product = store.readById(id);

  if (product === null || !ownsProduct(session, product.sellerId)) {
    return null;
  }

  return product;
}

async function loadOwned(
  id: string,
  permission: 'product:edit' | 'product:delete',
) {
  const session = await requirePermission(permission);
  const product = store.readById(id);

  if (product === null) {
    return { session, product: null };
  }

  if (!ownsProduct(session, product.sellerId)) {
    throw new PermissionError();
  }

  return { session, product };
}

export async function createProduct(input: ProductInput): Promise<Product> {
  const session = await requirePermission('product:create');
  const id = `${input.seo.slug}-${store.readAll().length + 1}`;

  return store.insert({
    ...input,
    id,
    sellerId: session.sellerId,
    tone: 'ocean',
    status: 'draft',
    rejectionReason: null,
    createdAt: todayIso(),
    updatedAt: todayIso(),
    createdBy: session.displayName,
    updatedBy: session.displayName,
    analytics: { views: 0, addToCart: 0, unitsSold: 0, revenueMinor: 0 },
    reviews: [],
    auditTrail: [auditEntry(session.displayName, 'Product', '—', 'Created')],
  });
}

export async function updateProduct(
  id: string,
  input: ProductInput,
): Promise<Product | null> {
  const { session, product } = await loadOwned(id, 'product:edit');

  if (product === null) {
    return null;
  }

  return store.replace({
    ...product,
    ...input,
    updatedAt: todayIso(),
    updatedBy: session.displayName,
    auditTrail: [
      ...product.auditTrail,
      auditEntry(session.displayName, 'Product details', 'previous', 'updated'),
    ],
  });
}

/**
 * Copies a product into a new draft. The copy starts empty of history,
 * analytics, and reviews, and its SKU and slug are suffixed so the new record
 * never collides with the original.
 */
export async function duplicateProduct(id: string): Promise<Product | null> {
  const session = await requirePermission('product:create');
  const source = store.readById(id);

  if (source === null) {
    return null;
  }

  if (!ownsProduct(session, source.sellerId)) {
    throw new PermissionError();
  }

  const suffix = store.readAll().length + 1;

  return store.insert({
    ...source,
    id: `${source.id}-copy-${suffix}`,
    name: `${source.name} (copy)`,
    identifiers: {
      ...source.identifiers,
      sku: `${source.identifiers.sku}-C${suffix}`,
      barcode: null,
    },
    variants: source.variants.map((variant, index) => ({
      ...variant,
      id: `${source.id}-copy-${suffix}-v${index + 1}`,
      sku: `${variant.sku}-C${suffix}`,
    })),
    seo: { ...source.seo, slug: `${source.seo.slug}-copy-${suffix}` },
    status: 'draft',
    rejectionReason: null,
    visibility: { ...source.visibility, published: false },
    createdAt: todayIso(),
    updatedAt: todayIso(),
    createdBy: session.displayName,
    updatedBy: session.displayName,
    analytics: { views: 0, addToCart: 0, unitsSold: 0, revenueMinor: 0 },
    reviews: [],
    auditTrail: [
      auditEntry(
        session.displayName,
        'Product',
        source.name,
        'Copied to a new draft',
      ),
    ],
  });
}

export async function applyTransition(
  id: string,
  transition: StatusTransition,
  reason: string | null = null,
): Promise<Product | null> {
  const rule = TRANSITION_RULES[transition];
  const session = await requirePermission(rule.permission);
  const product = store.readById(id);

  if (product === null) {
    return null;
  }

  if (!ownsProduct(session, product.sellerId)) {
    throw new PermissionError();
  }

  if (!isTransitionAllowed(transition, product.status)) {
    return null;
  }

  return store.replace({
    ...product,
    status: rule.to,
    rejectionReason: rule.needsReason ? reason : null,
    visibility: { ...product.visibility, published: rule.to === 'published' },
    updatedAt: todayIso(),
    updatedBy: session.displayName,
    auditTrail: [
      ...product.auditTrail,
      auditEntry(session.displayName, 'Status', product.status, rule.to),
    ],
  });
}

export async function deleteProducts(ids: readonly string[]): Promise<number> {
  const session = await requirePermission('product:delete');
  const owned = ids.filter((id) => {
    const product = store.readById(id);

    return product !== null && ownsProduct(session, product.sellerId);
  });

  return store.remove(owned);
}

/** Applies one transition to many products. Skips products that cannot move. */
export async function bulkTransition(
  ids: readonly string[],
  transition: StatusTransition,
): Promise<number> {
  const results = await Promise.all(
    ids.map((id) => applyTransition(id, transition)),
  );

  return results.filter((product) => product !== null).length;
}
