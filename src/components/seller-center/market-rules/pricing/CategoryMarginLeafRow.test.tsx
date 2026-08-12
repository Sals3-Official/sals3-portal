import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveCategoryPolicyAction: vi.fn(),
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
}));

/* eslint-disable import/first */
import { Table, TableBody } from '@/components/ui/table';
import type { CategoryMarginLeafViewModel } from './CategoryMarginGroupList';
import CategoryMarginLeafRow from './CategoryMarginLeafRow';

function renderLeaf(leaf: CategoryMarginLeafViewModel, canManage = true) {
  return render(
    <Table>
      <TableBody>
        <CategoryMarginLeafRow
          leaf={leaf}
          sellerAccountId="seller-1"
          canManage={canManage}
        />
      </TableBody>
    </Table>,
  );
}

const UNSET_LEAF: CategoryMarginLeafViewModel = {
  categoryId: 'category-1',
  code: 'CAT-DIG-100801',
  path: 'Digital Goods > Mobile Load > Telco Load Top-up',
  policy: null,
};

const SET_LEAF: CategoryMarginLeafViewModel = {
  categoryId: 'category-2',
  code: 'CAT-BEA-100869',
  path: 'Beauty > Hair Care > Shampoo',
  policy: {
    id: 'policy-1',
    targetMarginRate: '0.300000',
    roundingRule: 'NEAREST_0_99',
    version: 3,
    updatedAt: new Date('2026-08-04T00:00:00Z'),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CategoryMarginLeafRow', () => {
  it('shows "Not set" and no Deactivate button for a leaf with no active policy', () => {
    renderLeaf(UNSET_LEAF);

    expect(screen.getByText('Not set')).toBeInTheDocument();
    expect(screen.getByText('No active policy')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Deactivate' }),
    ).not.toBeInTheDocument();
  });

  it('shows the current rate, version, and Deactivate for a leaf with an active policy', () => {
    renderLeaf(SET_LEAF);

    expect(screen.getByText('30.00%')).toBeInTheDocument();
    expect(screen.getByText(/v3 · updated/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Deactivate' }),
    ).toBeInTheDocument();
  });

  it('hides inputs and Deactivate for a signer without manage permission', () => {
    renderLeaf(SET_LEAF, false);

    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Deactivate' }),
    ).not.toBeInTheDocument();
  });

  it('saves on the first click — a single leaf never arms', async () => {
    mocks.saveCategoryPolicyAction.mockResolvedValue({ ok: true });

    renderLeaf(UNSET_LEAF);

    fireEvent.change(
      screen.getByLabelText(
        'Margin percent for Digital Goods > Mobile Load > Telco Load Top-up',
      ),
      { target: { value: '5' } },
    );
    fireEvent.change(
      screen.getByLabelText(
        'Reason for change to Digital Goods > Mobile Load > Telco Load Top-up',
      ),
      { target: { value: 'Near-zero-margin prepaid load resale.' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mocks.saveCategoryPolicyAction).toHaveBeenCalledWith({
        categoryCode: UNSET_LEAF.code,
        targetMarginRate: '0.05',
        roundingRule: 'NONE',
        reason: 'Near-zero-margin prepaid load resale.',
      });
    });
    expect(mocks.refresh).toHaveBeenCalled();
  });
});
