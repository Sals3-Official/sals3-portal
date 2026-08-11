import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PipelinePagination from './PipelinePagination';

describe('PipelinePagination', () => {
  it('keeps the tab and search in both links', () => {
    render(
      <PipelinePagination
        page={3}
        totalPages={867}
        total={86_605}
        currentParams={{ tab: 'blocked', q: 'phone case' }}
      />,
    );

    expect(screen.getByRole('link', { name: /Previous/ })).toHaveAttribute(
      'href',
      '/products/pipeline?tab=blocked&q=phone+case&page=2',
    );
    expect(screen.getByRole('link', { name: /Next/ })).toHaveAttribute(
      'href',
      '/products/pipeline?tab=blocked&q=phone+case&page=4',
    );
    expect(
      screen.getByText('Page 3 of 867 · 86,605 candidates'),
    ).toBeInTheDocument();
  });

  it('offers no link past either end', () => {
    const { rerender } = render(
      <PipelinePagination
        page={1}
        totalPages={2}
        total={150}
        currentParams={{ tab: 'exception' }}
      />,
    );

    expect(
      screen.queryByRole('link', { name: /Previous/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Next/ })).toBeInTheDocument();

    rerender(
      <PipelinePagination
        page={2}
        totalPages={2}
        total={150}
        currentParams={{ tab: 'exception' }}
      />,
    );

    expect(screen.getByRole('link', { name: /Previous/ })).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Next/ }),
    ).not.toBeInTheDocument();
  });

  it('says candidate, singular, for a one-row tab', () => {
    render(
      <PipelinePagination
        page={1}
        totalPages={1}
        total={1}
        currentParams={{ tab: 'ready' }}
      />,
    );

    expect(screen.getByText('Page 1 of 1 · 1 candidate')).toBeInTheDocument();
  });
});
