import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OrderParcel } from '@/modules/orders/contracts';
import OrderParcelCard from './OrderParcelCard';

/**
 * The regression this exists for.
 *
 * The product link shipped on the detail card only, justified by "the list
 * card's whole row is already a link to the parcel". It is not: this card is
 * an `<article>` whose only link is the order reference in its header. The
 * list therefore kept plain titles while the detail linked, for no reason a
 * seller could see — and nothing failed, because no test asserted the list.
 */
const PARCEL: OrderParcel = {
  id: 'f0a1a0df-f2b5-4821-83fc-527dbeea5a1a',
  orderRef: 'S3-20260828-91CAC780B2',
  parcelIndex: 1,
  parcelCount: 1,
  buyerLabel: 'M****a · Quezon City',
  buyerMessage: null,
  lines: [
    {
      id: 'line-1',
      title: 'Straight Color Matching Casual All-matching Pants',
      variation: 'Light Gray-L',
      quantity: 1,
      imageUrl: null,
      acceptedOnLabel: 'as ordered on 28 Aug 2026',
      sku: 'S3V-6B18FBBBA77D',
      storefrontUrl: 'https://storefront.test/p/grey-pants',
      deliveryRangeLabel: null,
    },
  ],
  money: {
    buyerPaidLabel: '$13.51',
    commissionLabel: null,
    supplierCostLabel: null,
    supplierCostNote: 'Not configured.',
    wholeOrderNote: null,
  },
  status: {
    label: 'Supplier preparing',
    detail: 'The supplier is preparing this parcel for despatch.',
    tone: 'info',
  },
  state: 'FULFILLING',
  attentionReason: null,
  stage: 'supplier-preparing',
  route: {
    kind: 'SUPPLIER_DROPSHIP',
    serviceLevel: 'Express',
    carrier: 'CJPacket Asia Liquid Line',
    connection: {
      connectionId: 'conn-1',
      providerCode: 'CJ_DROPSHIPPING',
      label: 'CJ Dropshipping',
    },
    supplierOrderRef: 'CJ1',
    trackingNumber: null,
  },
  actions: [],
  selectable: false,
  channel: 'Sals3 PH',
  orderedAt: '2026-08-28',
  shipBy: null,
  proceedsMinor: 1351,
  currency: 'USD',
};

describe('OrderParcelCard', () => {
  it('links an ordered item to its product page, like the detail card does', () => {
    render(
      <OrderParcelCard
        parcel={PARCEL}
        selected={false}
        onToggle={vi.fn()}
        actionsSlot={null}
      />,
    );

    const link = screen.getByRole('link', { name: PARCEL.lines[0].title });

    expect(link.getAttribute('href')).toBe(
      'https://storefront.test/p/grey-pants',
    );
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('renders plain text when the product is not live', () => {
    render(
      <OrderParcelCard
        parcel={{
          ...PARCEL,
          lines: [{ ...PARCEL.lines[0], storefrontUrl: null }],
        }}
        selected={false}
        onToggle={vi.fn()}
        actionsSlot={null}
      />,
    );

    expect(
      screen.queryByRole('link', { name: PARCEL.lines[0].title }),
    ).toBeNull();
    expect(screen.getByText(PARCEL.lines[0].title)).toBeTruthy();
  });
});
