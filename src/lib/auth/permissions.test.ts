import { describe, expect, it } from 'vitest';
import { can, permissionsOf } from './permissions';

describe('Seller Center permissions', () => {
  it('grants admin every permission', () => {
    expect(can('admin', 'finance:read')).toBe(true);
    expect(can('admin', 'payout:manage')).toBe(true);
    expect(can('admin', 'market_rules:read')).toBe(true);
    expect(can('admin', 'catalog.candidate.shortlist')).toBe(true);
  });

  it('lets every role read candidates but only acting roles shortlist one', () => {
    expect(can('catalogue_reviewer', 'catalog.candidate.read')).toBe(true);
    expect(can('catalogue_reviewer', 'catalog.candidate.shortlist')).toBe(
      false,
    );
    expect(can('viewer', 'catalog.candidate.read')).toBe(true);
    expect(can('viewer', 'catalog.candidate.shortlist')).toBe(false);
    expect(can('seller_manager', 'catalog.candidate.shortlist')).toBe(true);
    expect(can('seller_staff', 'catalog.candidate.shortlist')).toBe(true);
  });

  it('keeps catalogue_reviewer scoped to catalogue QA only', () => {
    expect(permissionsOf('catalogue_reviewer')).not.toContain('order:read');
    expect(permissionsOf('catalogue_reviewer')).not.toContain('finance:read');
    expect(permissionsOf('catalogue_reviewer')).not.toContain('payout:read');
    expect(permissionsOf('catalogue_reviewer')).not.toContain(
      'inventory:adjust',
    );
  });

  it('gives seller_manager (Owner) full Seller Center access', () => {
    expect(can('seller_manager', 'order:fulfill')).toBe(true);
    expect(can('seller_manager', 'inventory:adjust')).toBe(true);
    expect(can('seller_manager', 'finance:read')).toBe(true);
    expect(can('seller_manager', 'payout:read')).toBe(true);
    expect(can('seller_manager', 'payout:manage')).toBe(true);
    expect(can('seller_manager', 'market_rules:read')).toBe(true);
  });

  it('blocks seller_staff (Staff) from finance and payout screens', () => {
    expect(can('seller_staff', 'order:fulfill')).toBe(true);
    expect(can('seller_staff', 'inventory:adjust')).toBe(true);
    expect(can('seller_staff', 'market_rules:read')).toBe(true);
    expect(can('seller_staff', 'finance:read')).toBe(false);
    expect(can('seller_staff', 'payout:read')).toBe(false);
    expect(can('seller_staff', 'payout:manage')).toBe(false);
  });

  it('separates seeing market rules from changing market setup', () => {
    // Every role that can open the page can read it; only owner-level roles
    // may change which destinations the account is configured for.
    expect(can('admin', 'market_profile:manage')).toBe(true);
    expect(can('seller_manager', 'market_profile:manage')).toBe(true);

    expect(can('seller_staff', 'market_rules:read')).toBe(true);
    expect(can('seller_staff', 'market_profile:manage')).toBe(false);
    expect(can('viewer', 'market_rules:read')).toBe(true);
    expect(can('viewer', 'market_profile:manage')).toBe(false);
    expect(can('catalogue_reviewer', 'market_profile:manage')).toBe(false);
  });

  it('gives viewer read-only access with no financial visibility', () => {
    expect(can('viewer', 'overview:read')).toBe(true);
    expect(can('viewer', 'order:read')).toBe(true);
    expect(can('viewer', 'inventory:read')).toBe(true);
    expect(can('viewer', 'market_rules:read')).toBe(true);
    expect(can('viewer', 'order:fulfill')).toBe(false);
    expect(can('viewer', 'inventory:adjust')).toBe(false);
    expect(can('viewer', 'finance:read')).toBe(false);
    expect(can('viewer', 'payout:read')).toBe(false);
  });
});
