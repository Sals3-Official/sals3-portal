import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CategoryPolicyWithCategory } from '@/modules/pricing/repository';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/app/(portal)/market-rules/pricing-actions', () => ({
  saveCategoryPolicyAction: vi.fn(),
  searchSals3CategoriesAction: vi.fn(),
  deactivateCategoryPolicyAction: vi.fn(),
}));

/* eslint-disable import/first */
import CategoryPricingTable from './CategoryPricingTable';

const POLICY: CategoryPolicyWithCategory = {
  id: 'policy-1',
  sellerAccountId: 'seller-1',
  categoryId: 'category-1',
  categoryCode: 'CAT-DIG-100801',
  categoryPath: 'Digital Goods > Mobile Load > Telco Load Top-up',
  targetMarginRate: '0.300000',
  roundingRule: 'NEAREST_0_99',
  status: 'ACTIVE',
  version: 2,
  supersedesId: null,
  reason: 'Standard department default.',
  actorId: 'user-1',
  createdAt: new Date('2026-08-01T00:00:00Z'),
  updatedAt: new Date('2026-08-10T00:00:00Z'),
};

describe('CategoryPricingTable', () => {
  it('shows the stable code, formatted margin, and rounding rule', () => {
    render(
      <CategoryPricingTable
        policies={[POLICY]}
        sellerAccountId="seller-1"
        canManage={false}
      />,
    );

    expect(
      screen.getByText('Digital Goods > Mobile Load > Telco Load Top-up'),
    ).toBeInTheDocument();
    expect(screen.getByText('CAT-DIG-100801')).toBeInTheDocument();
    expect(screen.getByText('30.00%')).toBeInTheDocument();
    expect(screen.getByText('Nearest .99')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
  });

  it('hides Edit/Deactivate controls for a caller who cannot manage pricing', () => {
    render(
      <CategoryPricingTable
        policies={[POLICY]}
        sellerAccountId="seller-1"
        canManage={false}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Edit' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Deactivate' }),
    ).not.toBeInTheDocument();
  });

  it('shows Edit/Deactivate controls for a caller who can manage pricing', () => {
    render(
      <CategoryPricingTable
        policies={[POLICY]}
        sellerAccountId="seller-1"
        canManage
      />,
    );

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Deactivate' }),
    ).toBeInTheDocument();
  });
});
