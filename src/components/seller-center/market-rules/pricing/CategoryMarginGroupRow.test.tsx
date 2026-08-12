import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveCategoryGroupMarginAction: vi.fn(),
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
  saveCategoryGroupMarginAction: mocks.saveCategoryGroupMarginAction,
}));

vi.mock('./CategoryMarginLeafRow', () => ({
  default: () => (
    <tr>
      <td>leaf row</td>
    </tr>
  ),
}));

/* eslint-disable import/first */
import { Table, TableBody } from '@/components/ui/table';
import type { CategoryMarginGroupViewModel } from './CategoryMarginGroupList';
import CategoryMarginGroupRow from './CategoryMarginGroupRow';

function renderRow(
  group: CategoryMarginGroupViewModel,
  overrides: { isExpanded?: boolean; onToggleExpanded?: () => void } = {},
) {
  return render(
    <Table>
      <TableBody>
        <CategoryMarginGroupRow
          group={group}
          sellerAccountId="seller-1"
          canManage
          isExpanded={overrides.isExpanded ?? false}
          onToggleExpanded={overrides.onToggleExpanded ?? vi.fn()}
        />
      </TableBody>
    </Table>,
  );
}

const UNSET_GROUP: CategoryMarginGroupViewModel = {
  groupKey: 'Digital Goods::Mobile Load',
  l1: 'Digital Goods, Services & Subscriptions',
  l2: 'Mobile Load & Prepaid Credits',
  leafCount: 1,
  setCount: 0,
  marginState: 'UNSET',
  uniformRate: null,
  uniformRoundingRule: null,
  leaves: [
    {
      categoryId: 'category-1',
      code: 'CAT-DIG-100801',
      path: 'Digital Goods > Mobile Load > Telco Load Top-up',
      policy: null,
    },
  ],
};

const UNIFORM_GROUP: CategoryMarginGroupViewModel = {
  groupKey: 'Beauty::Skincare',
  l1: 'Beauty & Personal Care',
  l2: 'Skincare',
  leafCount: 2,
  setCount: 2,
  marginState: 'UNIFORM',
  uniformRate: '0.250000',
  uniformRoundingRule: 'NONE',
  leaves: [
    {
      categoryId: 'category-2',
      code: 'CAT-BEA-1',
      path: 'Beauty > Skincare > Moisturizer',
      policy: {
        id: 'policy-2',
        targetMarginRate: '0.250000',
        roundingRule: 'NONE',
        version: 2,
        updatedAt: new Date('2026-08-01T00:00:00Z'),
      },
    },
    {
      categoryId: 'category-3',
      code: 'CAT-BEA-2',
      path: 'Beauty > Skincare > Cleanser',
      policy: {
        id: 'policy-3',
        targetMarginRate: '0.250000',
        roundingRule: 'NONE',
        version: 1,
        updatedAt: new Date('2026-08-01T00:00:00Z'),
      },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CategoryMarginGroupRow — UNSET group', () => {
  it('commits on the first Save click — nothing to overwrite', async () => {
    mocks.saveCategoryGroupMarginAction.mockResolvedValue({
      ok: true,
      data: { updatedCount: 1 },
    });

    renderRow(UNSET_GROUP);

    fireEvent.change(
      screen.getByLabelText('Margin percent for Mobile Load & Prepaid Credits'),
      { target: { value: '15' } },
    );
    fireEvent.change(
      screen.getByLabelText(
        'Reason for change to Mobile Load & Prepaid Credits',
      ),
      { target: { value: 'Near-zero-margin resale category default.' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mocks.saveCategoryGroupMarginAction).toHaveBeenCalledWith({
        l1: UNSET_GROUP.l1,
        l2: UNSET_GROUP.l2,
        targetMarginRate: '0.15',
        roundingRule: 'NONE',
        reason: 'Near-zero-margin resale category default.',
      });
    });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('disables Save until both margin and a real reason are present', () => {
    renderRow(UNSET_GROUP);

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

describe('CategoryMarginGroupRow — UNIFORM/MIXED group (arm-then-confirm)', () => {
  it('the first Save click arms instead of saving, and names the exact blast radius', () => {
    renderRow(UNIFORM_GROUP);

    fireEvent.change(screen.getByLabelText('Reason for change to Skincare'), {
      target: { value: 'Competitive pressure in this department.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mocks.saveCategoryGroupMarginAction).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        /This will overwrite 2 of 2 categories currently priced under Skincare/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Confirm: overwrite 2' }),
    ).toBeInTheDocument();
  });

  it('a second click on the armed button commits', async () => {
    mocks.saveCategoryGroupMarginAction.mockResolvedValue({
      ok: true,
      data: { updatedCount: 2 },
    });

    renderRow(UNIFORM_GROUP);

    fireEvent.change(screen.getByLabelText('Reason for change to Skincare'), {
      target: { value: 'Competitive pressure in this department.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm: overwrite 2' }),
    );

    await waitFor(() => {
      expect(mocks.saveCategoryGroupMarginAction).toHaveBeenCalledTimes(1);
    });
  });

  it('editing the margin after arming disarms it back to Save', () => {
    renderRow(UNIFORM_GROUP);

    fireEvent.change(screen.getByLabelText('Reason for change to Skincare'), {
      target: { value: 'Competitive pressure in this department.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      screen.getByRole('button', { name: 'Confirm: overwrite 2' }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Margin percent for Skincare'), {
      target: { value: '30' },
    });

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.queryByText(/This will overwrite/)).not.toBeInTheDocument();
  });

  it('the inline Cancel link disarms without saving', () => {
    renderRow(UNIFORM_GROUP);

    fireEvent.change(screen.getByLabelText('Reason for change to Skincare'), {
      target: { value: 'Competitive pressure in this department.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(mocks.saveCategoryGroupMarginAction).not.toHaveBeenCalled();
  });
});
