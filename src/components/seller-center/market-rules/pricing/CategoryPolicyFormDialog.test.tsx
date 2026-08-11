import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveCategoryPolicyAction: vi.fn(),
  searchSals3CategoriesAction: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: vi.fn() },
}));

vi.mock('@/app/(portal)/market-rules/pricing-actions', () => ({
  saveCategoryPolicyAction: mocks.saveCategoryPolicyAction,
  searchSals3CategoriesAction: mocks.searchSals3CategoriesAction,
}));

/* eslint-disable import/first */
import type { CategoryPolicyWithCategory } from '@/modules/pricing/repository';
import CategoryPolicyFormDialog from './CategoryPolicyFormDialog';

const EXISTING: CategoryPolicyWithCategory = {
  id: 'policy-1',
  sellerAccountId: 'seller-1',
  categoryId: 'category-1',
  categoryCode: 'CAT-DIG-100801',
  categoryPath: 'Digital Goods > Mobile Load > Telco Load Top-up',
  targetMarginRate: '0.300000',
  roundingRule: 'NONE',
  status: 'ACTIVE',
  version: 2,
  supersedesId: null,
  reason: 'Standard department default.',
  actorId: 'user-1',
  createdAt: new Date('2026-08-01T00:00:00Z'),
  updatedAt: new Date('2026-08-10T00:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CategoryPolicyFormDialog (edit mode)', () => {
  it('pre-fills the margin from the existing policy and submits the parsed rate', async () => {
    mocks.saveCategoryPolicyAction.mockResolvedValue({ ok: true });

    render(<CategoryPolicyFormDialog mode="edit" existing={EXISTING} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    const marginInput = await screen.findByLabelText('Target margin (%)');
    expect(marginInput).toHaveValue(30);

    fireEvent.change(marginInput, { target: { value: '35' } });
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Competitive pressure in this category.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mocks.saveCategoryPolicyAction).toHaveBeenCalledWith({
        categoryCode: 'CAT-DIG-100801',
        targetMarginRate: '0.35',
        roundingRule: 'NONE',
        reason: 'Competitive pressure in this category.',
      });
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Category policy updated.');
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('shows an inline error and keeps the dialog open when the action fails', async () => {
    mocks.saveCategoryPolicyAction.mockResolvedValue({
      ok: false,
      reason: 'failed',
    });

    render(<CategoryPolicyFormDialog mode="edit" existing={EXISTING} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    fireEvent.change(await screen.findByLabelText('Reason'), {
      target: { value: 'Trying to update this once more.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('Check the highlighted fields and try again.'),
    ).toBeInTheDocument();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    // Dialog stays open: the Save button is still present once the pending
    // transition (briefly "Saving…") has settled back.
    expect(
      await screen.findByRole('button', { name: 'Save' }),
    ).toBeInTheDocument();
  });
});

describe('CategoryPolicyFormDialog (create mode)', () => {
  it('disables Save until a category is selected from search results', async () => {
    mocks.searchSals3CategoriesAction.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'category-1',
          code: 'CAT-DIG-100801',
          l1: 'Digital Goods',
          l2: null,
          l3: null,
          l4: null,
          l5: null,
          path: 'Digital Goods > Mobile Load',
          taxonomyStatus: 'ADOPTED',
          createdAt: new Date('2026-08-01T00:00:00Z'),
        },
      ],
    });

    render(<CategoryPolicyFormDialog mode="create" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Add category policy' }),
    );

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.change(
      await screen.findByPlaceholderText('Search by name or code…'),
      {
        target: { value: 'digital' },
      },
    );

    await waitFor(() => {
      expect(mocks.searchSals3CategoriesAction).toHaveBeenCalledWith('digital');
    });
  });
});
