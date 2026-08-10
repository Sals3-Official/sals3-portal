import type { PortalDisplayCurrencyPolicy } from './types';

/**
 * Portal's temporary seller-facing display/reference currency context
 * (ADR-014), following Sals3's Australian business registration. This is a
 * display dimension only: it must never be read as buyer destination-country
 * eligibility, an approved landed cost, or a checkout currency.
 *
 * The real customer storefront checkout currency is a separate, currently
 * USD-denominated concern (`src/lib/storefront/fx.ts`, a deferred
 * cross-repository contract with `sals3-ecommerce`) and is unaffected by
 * this resolver.
 */
const SOURCE = 'owner-decision-2026-08-10-au-business-registration';

export default function resolvePortalDisplayCurrency(): PortalDisplayCurrencyPolicy {
  return { code: 'AUD', source: SOURCE };
}
