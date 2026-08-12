import { describe, expect, it } from 'vitest';
import { displayName } from './candidate-view';

/**
 * `displayName` is the single name resolver behind all five pipeline tables,
 * so the precedence it implements is worth pinning: evidence, then the
 * discovery feed snapshot, then the raw provider id as a last resort.
 *
 * The feed-snapshot case is the one that regressed in production - evidence
 * exists for a tiny fraction of candidates, so reading it alone showed the
 * numeric provider id on almost every row.
 */

const PID = '2608100816131603600';

/** Only the fields `displayName` reads; the real evidence object is far larger. */
function evidence(name: string) {
  return { name } as unknown as Parameters<
    typeof displayName
  >[0]['evidence'] & { name: string };
}

function candidate(input: {
  evidenceName?: string;
  feedSnapshot?: unknown;
}): Parameters<typeof displayName>[0] {
  return {
    externalProductId: PID,
    evidence:
      input.evidenceName === undefined ? null : evidence(input.evidenceName),
    evaluation: { feedSnapshot: input.feedSnapshot ?? null },
  };
}

/** A feed snapshot with every required field, so `safeParse` succeeds. */
function feed(name: string) {
  return {
    name,
    category: 'Jewelry',
    priceUsdCents: 404,
    listedCount: null,
    shipsFrom: ['CN'],
  };
}

describe('displayName', () => {
  it('prefers the evidence name when a detail fetch captured one', () => {
    expect(
      displayName(
        candidate({
          evidenceName: 'Stainless Steel Personalized Skull Ring',
          feedSnapshot: feed('Feed name'),
        }),
      ),
    ).toBe('Stainless Steel Personalized Skull Ring');
  });

  it('uses the discovery feed snapshot when no evidence has been captured', () => {
    expect(
      displayName(
        candidate({
          feedSnapshot: feed('Stainless Steel Personalized Skull Ring'),
        }),
      ),
    ).toBe('Stainless Steel Personalized Skull Ring');
  });

  it('falls through an empty evidence name to the feed snapshot', () => {
    expect(
      displayName({
        externalProductId: PID,
        evidence: evidence(''),
        evaluation: { feedSnapshot: feed('V-neck Fashion Drawstring Dress') },
      }),
    ).toBe('V-neck Fashion Drawstring Dress');
  });

  it('falls back to the provider id only when neither source carries a name', () => {
    expect(displayName(candidate({}))).toBe(PID);
  });

  it('falls back to the provider id rather than throwing on an unparseable snapshot', () => {
    expect(displayName(candidate({ feedSnapshot: { name: 42 } }))).toBe(PID);
    expect(displayName(candidate({ feedSnapshot: 'not an object' }))).toBe(PID);
  });

  it('falls back to the provider id when the snapshot name is empty', () => {
    expect(displayName(candidate({ feedSnapshot: feed('') }))).toBe(PID);
  });
});
