import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Market Rules is a production seller-facing screen, so it must not reach
 * the illustrative PH/ID/SG market fixture at all.
 *
 * A rendering assertion alone would not catch a regression here: in
 * development `getActiveMarket()` returns a fixture market, so an accidental
 * re-import would look fine locally and only collapse to the generic
 * "not available" placeholder in production — exactly the bug this work
 * removed. Checking the import graph catches it wherever it runs.
 */

const MARKET_RULES_DIR = join(process.cwd(), 'src/app/(portal)/market-rules');
const PROFILE_COMPONENT_DIR = join(
  process.cwd(),
  'src/components/seller-center/market-rules/profile',
);

/**
 * Comments are stripped first: these files legitimately *describe* the
 * fixture they no longer use, and prose explaining why something was removed
 * must not read as the thing still being there.
 */
function read(...segments: string[]): string {
  return readFileSync(join(...segments), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const PRODUCTION_SOURCES = [
  read(MARKET_RULES_DIR, 'page.tsx'),
  read(MARKET_RULES_DIR, 'market-profile-actions.ts'),
  read(PROFILE_COMPONENT_DIR, 'MarketProfileSection.tsx'),
  read(PROFILE_COMPONENT_DIR, 'MarketProfileCard.tsx'),
  read(PROFILE_COMPONENT_DIR, 'PolicyContextPanel.tsx'),
];

describe('Market Rules fixture independence', () => {
  it('imports nothing from the illustrative market fixture', () => {
    PRODUCTION_SOURCES.forEach((source) => {
      expect(source).not.toMatch(/from '@\/lib\/seller-center\/market-config'/);
    });
  });

  it('does not call the fixture accessors', () => {
    PRODUCTION_SOURCES.forEach((source) => {
      expect(source).not.toContain('getActiveMarket(');
      expect(source).not.toContain('getAllMarkets(');
      expect(source).not.toContain('SELLER_CENTER_MARKET');
    });
  });

  it('does not rebuild the removed fixture rule table', () => {
    PRODUCTION_SOURCES.forEach((source) => {
      expect(source).not.toContain('buildMarketRules');
    });
  });

  it('reads the seller profile from the real repository instead', () => {
    expect(read(PROFILE_COMPONENT_DIR, 'MarketProfileSection.tsx')).toContain(
      "from '@/modules/market-config/repository'",
    );
  });
});
