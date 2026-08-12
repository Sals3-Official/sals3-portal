import { describe, expect, it } from 'vitest';
import { displayName, imageUrl, supplierPriceUsd } from './candidate-view';

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

/**
 * `supplierPriceUsd` mirrors `displayName`'s precedence. The unit change is
 * the part worth pinning: evidence stores USD, the feed snapshot stores cents,
 * and screening decides `INVALID_PRICE` from the cents value - so a wrong
 * conversion here would show a price 100x off the one the row was judged on.
 */
describe('supplierPriceUsd', () => {
  /** Only the field `supplierPriceUsd` reads. */
  function priced(supplierPriceUsdValue: number | null) {
    return { supplierPriceUsd: supplierPriceUsdValue } as unknown as Parameters<
      typeof supplierPriceUsd
    >[0]['evidence'];
  }

  function row(input: {
    evidencePrice?: number | null;
    feedSnapshot?: unknown;
  }): Parameters<typeof supplierPriceUsd>[0] {
    return {
      evidence:
        input.evidencePrice === undefined ? null : priced(input.evidencePrice),
      evaluation: { feedSnapshot: input.feedSnapshot ?? null },
    };
  }

  function feedAt(priceUsdCents: number | null) {
    return {
      name: 'Stainless Steel Personalized Skull Ring',
      category: 'Jewelry',
      priceUsdCents,
      listedCount: null,
      shipsFrom: ['CN'],
    };
  }

  it('prefers the evidence price when a detail fetch captured one', () => {
    expect(
      supplierPriceUsd(row({ evidencePrice: 4.04, feedSnapshot: feedAt(999) })),
    ).toBe(4.04);
  });

  it('converts the feed snapshot from cents to USD when there is no evidence', () => {
    expect(supplierPriceUsd(row({ feedSnapshot: feedAt(404) }))).toBe(4.04);
    expect(supplierPriceUsd(row({ feedSnapshot: feedAt(2517) }))).toBe(25.17);
  });

  it('falls through a null evidence price to the feed snapshot', () => {
    expect(
      supplierPriceUsd(row({ evidencePrice: null, feedSnapshot: feedAt(538) })),
    ).toBe(5.38);
  });

  it('treats a free item as a real price, not as unknown', () => {
    expect(supplierPriceUsd(row({ feedSnapshot: feedAt(0) }))).toBe(0);
  });

  it('returns null when neither source carries a price', () => {
    expect(supplierPriceUsd(row({}))).toBeNull();
    expect(supplierPriceUsd(row({ feedSnapshot: feedAt(null) }))).toBeNull();
    expect(supplierPriceUsd(row({ feedSnapshot: 'not an object' }))).toBeNull();
  });
});

/**
 * The host check on the read path. `feedSnapshotSchema.imageUrl` is a plain
 * string and `cjImageUrl` only guards the discovery WRITE path, so without this
 * a value planted by a manual UPDATE, a backfill, or a future ingest path would
 * become a browser GET from the seller's session - and the custom image loader
 * passes a non-CJ address through unchanged.
 */
describe('imageUrl', () => {
  function withImage(address: unknown) {
    return {
      evaluation: {
        feedSnapshot: { ...feed('Bracelet'), imageUrl: address },
      },
    };
  }

  it('accepts an https address on an allow-listed CJ host', () => {
    const address = 'https://cf.cjdropshipping.com/quick/product/a.jpg';

    expect(imageUrl(withImage(address))).toBe(address);
    expect(
      imageUrl(withImage('https://oss-cf.cjdropshipping.com/product/b.jpg')),
    ).toBe('https://oss-cf.cjdropshipping.com/product/b.jpg');
  });

  it('rejects a lookalike host, a bare http address, and a relative path', () => {
    [
      'https://cf.cjdropshipping.com.evil.example.com/c.jpg',
      'https://notcf.cjdropshipping.com/c.jpg',
      'https://evil.example.com/c.jpg',
      'http://cf.cjdropshipping.com/a.jpg',
      '/local/path.jpg',
      'not a url at all',
    ].forEach((address) => {
      expect(imageUrl(withImage(address))).toBeNull();
    });
  });

  it('returns null for an absent address and an unparseable snapshot', () => {
    expect(imageUrl(withImage(null))).toBeNull();
    expect(imageUrl(withImage(''))).toBeNull();
    expect(imageUrl({ evaluation: { feedSnapshot: null } })).toBeNull();
    expect(
      imageUrl({ evaluation: { feedSnapshot: { junk: true } } }),
    ).toBeNull();
  });
});
