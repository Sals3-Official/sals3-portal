import buildFixtureCatalogue from '@/lib/products/fixtures';
import type { Product } from '@/lib/products/types';

/**
 * In-memory catalogue store.
 *
 * This is the only place that holds product state. It stands in for the real
 * repository until the catalogue service and database exist, so writes do not
 * survive a server restart, and each server instance keeps its own copy. The
 * function signatures match what a database repository would expose, so
 * swapping the body out later does not touch any component or server action.
 *
 * The store is cached on `globalThis` because the Next.js dev server reloads
 * modules on every edit, which would otherwise reset the catalogue mid-session.
 */

type StoreState = { products: Product[] };

const STORE_KEY = Symbol.for('sals3.portal.productStore');

type GlobalWithStore = typeof globalThis & {
  [STORE_KEY]?: StoreState;
};

function state(): StoreState {
  const scope = globalThis as GlobalWithStore;

  scope[STORE_KEY] ??= { products: buildFixtureCatalogue() };

  return scope[STORE_KEY];
}

export function readAll(): readonly Product[] {
  return state().products;
}

export function readById(id: string): Product | null {
  return state().products.find((product) => product.id === id) ?? null;
}

export function insert(product: Product): Product {
  state().products.unshift(product);

  return product;
}

export function replace(product: Product): Product | null {
  const { products } = state();
  const index = products.findIndex((item) => item.id === product.id);

  if (index === -1) {
    return null;
  }

  products[index] = product;

  return product;
}

export function remove(ids: readonly string[]): number {
  const store = state();
  const before = store.products.length;

  store.products = store.products.filter(
    (product) => !ids.includes(product.id),
  );

  return before - store.products.length;
}

/** Test helper: put the store back to the fixture catalogue. */
export function resetStore(): void {
  (globalThis as GlobalWithStore)[STORE_KEY] = {
    products: buildFixtureCatalogue(),
  };
}
