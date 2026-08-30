import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CataloguePublishResults from './CataloguePublishResults';

describe('CataloguePublishResults', () => {
  /** Nothing has run, so there is nothing to report. */
  it('renders nothing before a publish has run', () => {
    const { container } = render(
      <CataloguePublishResults outcomes={[]} onDismiss={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  /**
   * The defect this component exists to prevent: a toast reading "2 failed"
   * names no product and no reason. Every refusal here must carry both.
   */
  it('names every refused product and the fact it is missing', () => {
    render(
      <CataloguePublishResults
        outcomes={[
          {
            productId: 'p1',
            name: 'Ice Silk Trousers',
            slug: 'ice-silk-trousers',
            offerCount: 2,
          },
          {
            productId: 'p2',
            name: 'Camouflage Jeans',
            failure: 'No approved product image is on file yet.',
          },
          {
            productId: 'p3',
            name: 'Hooded Sweater',
            failure: 'No supplier cost has been observed.',
          },
        ]}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText('Camouflage Jeans')).toBeInTheDocument();
    expect(
      screen.getByText('No approved product image is on file yet.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Hooded Sweater')).toBeInTheDocument();
    expect(
      screen.getByText('No supplier cost has been observed.'),
    ).toBeInTheDocument();
  });

  /**
   * Successes are listed, not merely counted: a seller checking whether one
   * specific listing went live should not have to go looking.
   */
  it('lists what published, with where it landed', () => {
    render(
      <CataloguePublishResults
        outcomes={[
          {
            productId: 'p1',
            name: 'Ice Silk Trousers',
            slug: 'ice-silk-trousers',
            offerCount: 2,
          },
        ]}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText('Ice Silk Trousers')).toBeInTheDocument();
    expect(
      screen.getByText(/live now at \/p\/ice-silk-trousers with 2 offers/i),
    ).toBeInTheDocument();
  });

  it('counts the two outcomes separately in the heading', () => {
    render(
      <CataloguePublishResults
        outcomes={[
          { productId: 'p1', name: 'A', slug: 'a', offerCount: 1 },
          { productId: 'p2', name: 'B', failure: 'No active variant yet.' },
          { productId: 'p3', name: 'C', failure: 'No active market profile.' },
        ]}
        onDismiss={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('heading', {
        name: '1 listing published, 2 left as drafts',
      }),
    ).toBeInTheDocument();
  });

  /** A run where everything worked should not imply anything was refused. */
  it('says nothing about drafts when nothing was refused', () => {
    render(
      <CataloguePublishResults
        outcomes={[{ productId: 'p1', name: 'A', slug: 'a', offerCount: 1 }]}
        onDismiss={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('heading', { name: '1 listing published' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/left as/i)).not.toBeInTheDocument();
  });
});
