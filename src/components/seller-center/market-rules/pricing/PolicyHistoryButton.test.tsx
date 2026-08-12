import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AuditHistoryEntry } from '@/modules/catalog/candidates/repository';
import PolicyHistoryButton from './PolicyHistoryButton';

function open(triggerLabel: string) {
  fireEvent.click(screen.getByRole('button', { name: triggerLabel }));
}

describe('PolicyHistoryButton', () => {
  it('does not fetch until the popover is actually opened', () => {
    const fetchHistory = vi.fn().mockResolvedValue({ ok: true, data: [] });

    render(
      <PolicyHistoryButton
        title="History — Prepaid Airtime"
        ariaLabel="History for Prepaid Airtime"
        fetchHistory={fetchHistory}
      />,
    );

    expect(fetchHistory).not.toHaveBeenCalled();
  });

  it('fetches once on first open and shows "No history yet." for an empty result', async () => {
    const fetchHistory = vi.fn().mockResolvedValue({ ok: true, data: [] });

    render(
      <PolicyHistoryButton
        title="History — Prepaid Airtime"
        ariaLabel="History for Prepaid Airtime"
        fetchHistory={fetchHistory}
      />,
    );

    open('History for Prepaid Airtime');

    expect(await screen.findByText('No history yet.')).toBeInTheDocument();
    expect(fetchHistory).toHaveBeenCalledTimes(1);
  });

  it('shows an inline error state without throwing when the read fails', async () => {
    const fetchHistory = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: 'failed' });

    render(
      <PolicyHistoryButton
        title="History — Prepaid Airtime"
        ariaLabel="History for Prepaid Airtime"
        fetchHistory={fetchHistory}
      />,
    );

    open('History for Prepaid Airtime');

    expect(
      await screen.findByText('History is not available right now.'),
    ).toBeInTheDocument();
  });

  it('renders a friendly action label, actor, reason, and the value for each entry — never the raw action code', async () => {
    const entries: AuditHistoryEntry[] = [
      {
        id: 'event-2',
        action: 'category_pricing_policy.revised',
        createdAt: new Date('2026-08-04T11:18:00Z'),
        actorName: 'Rosa Villamor',
        actorEmail: 'rosa@sals3.com',
        payload: {
          targetMarginRate: '0.300000',
          reason: 'Aligning to the new supplier cost band.',
        },
      },
      {
        id: 'event-1',
        action: 'category_pricing_policy.created',
        createdAt: new Date('2026-07-21T09:44:00Z'),
        actorName: 'ops@sals3.com',
        actorEmail: null,
        payload: {
          targetMarginRate: '0.250000',
          reason: 'Initial setup during the AU pilot onboarding.',
        },
      },
    ];
    const fetchHistory = vi.fn().mockResolvedValue({ ok: true, data: entries });

    render(
      <PolicyHistoryButton
        title="History — Prepaid Airtime"
        ariaLabel="History for Prepaid Airtime"
        fetchHistory={fetchHistory}
      />,
    );

    open('History for Prepaid Airtime');

    expect(await screen.findByText('Revised')).toBeInTheDocument();
    expect(screen.getByText('25.00% → 30.00%')).toBeInTheDocument();
    expect(screen.getByText('Rosa Villamor')).toBeInTheDocument();
    expect(
      screen.getByText('Aligning to the new supplier cost band.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('ops@sals3.com')).toBeInTheDocument();
    expect(
      screen.queryByText(/category_pricing_policy/),
    ).not.toBeInTheDocument();
  });

  it('labels a bulk-applied entry "Bulk applied" regardless of created/revised underneath', async () => {
    const entries: AuditHistoryEntry[] = [
      {
        id: 'event-1',
        action: 'category_pricing_policy.created',
        createdAt: new Date('2026-08-04T11:18:00Z'),
        actorName: 'Rosa Villamor',
        actorEmail: 'rosa@sals3.com',
        payload: {
          targetMarginRate: '0.300000',
          reason: 'Aligning hair care to the new supplier cost band.',
          bulkOperationId: 'bulk-1',
          bulkL1: 'Beauty & Personal Care',
          bulkL2: 'Hair Care',
        },
      },
    ];
    const fetchHistory = vi.fn().mockResolvedValue({ ok: true, data: entries });

    render(
      <PolicyHistoryButton
        title="History — Hair Care (bulk changes)"
        ariaLabel="Bulk change history for Hair Care"
        fetchHistory={fetchHistory}
      />,
    );

    open('Bulk change history for Hair Care');

    expect(await screen.findByText('Bulk applied')).toBeInTheDocument();
    expect(screen.queryByText('Created')).not.toBeInTheDocument();
  });

  it('signs a funding-buffer adjustment rate and shows a negative value correctly', async () => {
    const entries: AuditHistoryEntry[] = [
      {
        id: 'event-1',
        action: 'funding_buffer_policy.created',
        createdAt: new Date('2026-07-02T16:40:00Z'),
        actorName: 'Rosa Villamor',
        actorEmail: 'rosa@sals3.com',
        payload: {
          adjustmentRate: '-0.025000',
          reason: 'AUD strengthened against the USD.',
        },
      },
    ];
    const fetchHistory = vi.fn().mockResolvedValue({ ok: true, data: entries });

    render(
      <PolicyHistoryButton
        title="History — Funding buffer"
        ariaLabel="Funding buffer history"
        fetchHistory={fetchHistory}
      />,
    );

    open('Funding buffer history');

    expect(await screen.findByText('-2.50%')).toBeInTheDocument();
  });
});
