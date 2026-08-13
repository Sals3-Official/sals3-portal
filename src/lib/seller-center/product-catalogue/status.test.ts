import { describe, expect, it } from 'vitest';
import { LISTINGS_STATUS_FILTERS } from '@/lib/portal/listings-params';
import {
  presentPublicationState,
  statesForFilter,
  type ProductPublicationState,
} from './status';

const ALL_STATES: ProductPublicationState[] = [
  'UNPUBLISHED',
  'PUBLISHED',
  'PAUSED',
  'ARCHIVED',
];

describe('presentPublicationState', () => {
  /** Exhaustive: a new enum value must get a deliberate label, not a crash. */
  it('labels every persisted state', () => {
    expect(ALL_STATES.map((state) => presentPublicationState(state))).toEqual([
      { label: 'Draft', tone: 'neutral', filter: 'draft' },
      { label: 'Live', tone: 'success', filter: 'live' },
      { label: 'Paused', tone: 'warning', filter: 'paused' },
      { label: 'Archived', tone: 'neutral', filter: 'archived' },
    ]);
  });
});

describe('statesForFilter', () => {
  it('maps every URL filter onto exactly one state, and all onto all', () => {
    expect(statesForFilter('all')).toEqual(ALL_STATES);
    LISTINGS_STATUS_FILTERS.filter((filter) => filter !== 'all').forEach(
      (filter) => {
        const states = statesForFilter(filter);

        expect(states).toHaveLength(1);
        expect(presentPublicationState(states[0]).filter).toBe(filter);
      },
    );
  });
});
