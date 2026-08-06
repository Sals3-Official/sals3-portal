import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CandidateEvidence } from '@/lib/cj/evidence';
import ShortlistDrawer from './ShortlistDrawer';

const SUCCESS = {
  ok: true as const,
  candidateId: '11111111-1111-4111-8111-111111111111',
  shortlistState: 'SHORTLISTED' as const,
  reused: false,
  evidence: null,
};

/** Mirrors the shape captured from the live CJ API on 2026-08-07. */
const EVIDENCE: CandidateEvidence = {
  externalProductId: '2608061016491610100',
  name: 'Womens Floral Print Elastic-Waist Dress',
  supplierSku: 'CJLY3042134',
  categoryName: 'Lady Dresses',
  entryCode: '6104430000',
  supplierPriceUsd: 6.25,
  packedWeight: '300.00-340.00',
  sourceStatusRaw: '3',
  isTestProduct: false,
  listedCount: 1,
  usableImageCount: 4,
  variants: [
    {
      vid: '2608061016491610600',
      sku: 'CJLY304213401AZ',
      optionLabel: 'Black-1XL',
      priceUsd: 6.25,
      weightGrams: 320,
      totalInventory: 12,
    },
  ],
  warehouses: [
    { countryCode: 'CN', name: 'China Warehouse', totalInventory: 12 },
  ],
  reviews: { totalCount: 0, sampledCount: 0, sampledAverageScore: null },
  capturedAt: '2026-08-07T00:00:00.000Z',
};

describe('ShortlistDrawer', () => {
  it('shows the stored candidate id and state for a shortlisted candidate', () => {
    render(
      <ShortlistDrawer
        productName="Widget"
        result={SUCCESS}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByText(SUCCESS.candidateId)).toBeInTheDocument();
    expect(screen.getByText('SHORTLISTED')).toBeInTheDocument();
  });

  it('always states that preflight has not run, so no score is implied', () => {
    render(
      <ShortlistDrawer
        productName="Widget"
        result={SUCCESS}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/full preflight has not run for this candidate/i),
    ).toBeInTheDocument();
  });

  it('distinguishes a reused candidate from a newly created one', () => {
    render(
      <ShortlistDrawer
        productName="Widget"
        result={{ ...SUCCESS, reused: true }}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/already shortlisted earlier/i),
    ).toBeInTheDocument();
  });

  it('shows no candidate id when the shortlist failed', () => {
    render(
      <ShortlistDrawer
        productName="Widget"
        result={{ ok: false, reason: 'failed' }}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.queryByText('Candidate ID')).not.toBeInTheDocument();
    expect(
      screen.getByText('Saving the candidate failed. Try again in a moment.'),
    ).toBeInTheDocument();
  });

  it('renders real CJ evidence when it was captured', () => {
    render(
      <ShortlistDrawer
        productName="Widget"
        result={{ ...SUCCESS, evidence: EVIDENCE }}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText('CJLY3042134')).toBeInTheDocument();
    expect(screen.getByText('Lady Dresses')).toBeInTheDocument();
    expect(screen.getByText('$6.25')).toBeInTheDocument();
    expect(screen.getByText('Black-1XL')).toBeInTheDocument();
    expect(screen.getByText('China Warehouse')).toBeInTheDocument();
  });

  it('does not crash when the payload omits evidence entirely', () => {
    // An older client bundle after a deploy can post a result with no
    // `evidence` key at all. That must degrade to the "could not fetch"
    // message, not throw and take the row down.
    const withoutEvidence = {
      ok: true as const,
      candidateId: SUCCESS.candidateId,
      shortlistState: 'SHORTLISTED' as const,
      reused: false,
    } as unknown as typeof SUCCESS;

    render(
      <ShortlistDrawer
        productName="Widget"
        result={withoutEvidence}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/CJ evidence could not be fetched/i),
    ).toBeInTheDocument();
  });

  it('says evidence could not be fetched rather than implying there is none', () => {
    render(
      <ShortlistDrawer
        productName="Widget"
        result={{ ...SUCCESS, evidence: null }}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/CJ evidence could not be fetched/i),
    ).toBeInTheDocument();
  });
});
