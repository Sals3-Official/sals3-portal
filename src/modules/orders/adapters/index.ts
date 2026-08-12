import type { SupplierAdapter } from '../supplier-adapter';
import cjAdapter from './cj';

/**
 * The adapter registry.
 *
 * Adding a provider means adding a file and one line here. Nothing else in the
 * codebase learns its name: components and the order worker resolve an adapter
 * by `providerCode` and then ask it what it can do.
 *
 * ADR-008 §"Phase 1" keeps this list to reviewed, first-party adapters. It is
 * not a plugin surface - no seller-supplied code, host, or callback is loaded
 * here.
 */
const ADAPTERS: readonly SupplierAdapter[] = [cjAdapter];

/**
 * Returns `null` for an unregistered provider rather than a default adapter.
 *
 * A fallback would silently grant some other provider's capabilities to a
 * connection nobody has reviewed, which is exactly the assumption ADR-008
 * forbids. The caller renders the parcel without supplier actions instead.
 */
export function findSupplierAdapter(
  providerCode: string,
): SupplierAdapter | null {
  return (
    ADAPTERS.find((adapter) => adapter.providerCode === providerCode) ?? null
  );
}

export function registeredProviderCodes(): string[] {
  return ADAPTERS.map((adapter) => adapter.providerCode);
}
