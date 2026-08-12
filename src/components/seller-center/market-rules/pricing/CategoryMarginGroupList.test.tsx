import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./CategoryMarginGroupRow', () => ({
  default: ({ group: row }: { group: { groupKey: string; l2: string } }) => (
    <tr>
      <td>{row.l2}</td>
    </tr>
  ),
}));

/* eslint-disable import/first */
import type { CategoryMarginGroupViewModel } from './CategoryMarginGroupList';
import CategoryMarginGroupList from './CategoryMarginGroupList';

function group(
  overrides: Partial<CategoryMarginGroupViewModel> = {},
): CategoryMarginGroupViewModel {
  return {
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
        path: 'Digital Goods, Services & Subscriptions > Mobile Load & Prepaid Credits > Telco Load Top-up',
        policy: null,
      },
    ],
    ...overrides,
  };
}

const GROUPS: CategoryMarginGroupViewModel[] = [
  group(),
  group({
    groupKey: 'Beauty::Hair Care',
    l1: 'Beauty & Personal Care',
    l2: 'Hair Care',
    leaves: [
      {
        categoryId: 'category-2',
        code: 'CAT-BEA-100869',
        path: 'Beauty & Personal Care > Hair Care > Shampoo',
        policy: null,
      },
    ],
  }),
];

describe('CategoryMarginGroupList', () => {
  it('renders every group, including ones with nothing configured — never hidden for being empty', () => {
    render(
      <CategoryMarginGroupList
        groups={GROUPS}
        sellerAccountId="seller-1"
        canManage
      />,
    );

    expect(
      screen.getByText('Mobile Load & Prepaid Credits'),
    ).toBeInTheDocument();
    expect(screen.getByText('Hair Care')).toBeInTheDocument();
    expect(screen.getByText('2 of 2 shown')).toBeInTheDocument();
  });

  it('filters client-side by L1/L2 name with no network call', () => {
    render(
      <CategoryMarginGroupList
        groups={GROUPS}
        sellerAccountId="seller-1"
        canManage
      />,
    );

    fireEvent.change(screen.getByLabelText('Search categories'), {
      target: { value: 'hair' },
    });

    expect(
      screen.queryByText('Mobile Load & Prepaid Credits'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Hair Care')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 shown')).toBeInTheDocument();
  });

  it('filters by a leaf path/code even when the group name itself does not match', () => {
    render(
      <CategoryMarginGroupList
        groups={GROUPS}
        sellerAccountId="seller-1"
        canManage
      />,
    );

    fireEvent.change(screen.getByLabelText('Search categories'), {
      target: { value: 'shampoo' },
    });

    expect(screen.getByText('Hair Care')).toBeInTheDocument();
    expect(
      screen.queryByText('Mobile Load & Prepaid Credits'),
    ).not.toBeInTheDocument();
  });

  it('shows a clear-search message and keeps the search bar when nothing matches', () => {
    render(
      <CategoryMarginGroupList
        groups={GROUPS}
        sellerAccountId="seller-1"
        canManage
      />,
    );

    fireEvent.change(screen.getByLabelText('Search categories'), {
      target: { value: 'nonexistent department' },
    });

    expect(
      screen.getByText('No department or category matches that search.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Search categories')).toBeInTheDocument();
  });
});
