import { describe, expect, it } from 'vitest';
import {
  externalProductIdSchema,
  marketCodeSchema,
  shortlistCandidateCommandSchema,
  shortlistCandidateInputSchema,
} from './contracts';

describe('externalProductIdSchema', () => {
  it('accepts a real CJ pid shape', () => {
    expect(externalProductIdSchema.parse('CJLY3042134')).toBe('CJLY3042134');
    expect(externalProductIdSchema.parse('2409A-1_b.c:d')).toBe(
      '2409A-1_b.c:d',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(externalProductIdSchema.parse('  CJLY1  ')).toBe('CJLY1');
  });

  it.each([
    ['empty', ''],
    ['a space inside', 'CJ LY1'],
    ['a quote', "CJ'LY1"],
    ['a semicolon', 'CJLY1;DROP'],
    ['angle brackets', '<script>'],
    ['a percent sign', 'CJ%20LY'],
    ['over 64 chars', 'a'.repeat(65)],
  ])('rejects %s', (_label, value) => {
    expect(() => externalProductIdSchema.parse(value)).toThrow();
  });
});

describe('marketCodeSchema', () => {
  it('accepts a two-letter uppercase code', () => {
    expect(marketCodeSchema.parse('PH')).toBe('PH');
  });

  it.each(['ph', 'PHL', 'P', '', '12'])('rejects %s', (value) => {
    expect(() => marketCodeSchema.parse(value)).toThrow();
  });
});

describe('shortlistCandidateInputSchema', () => {
  it('accepts only the supplier product id from the client', () => {
    const parsed = shortlistCandidateInputSchema.parse({
      externalProductId: 'CJLY1',
      // Anything a hostile client bolts on must not survive parsing.
      intendedSellerId: 'attacker-seller',
      shortlistState: 'PREFLIGHT_PENDING',
      price: 1,
    });

    expect(parsed).toEqual({ externalProductId: 'CJLY1' });
    expect(parsed).not.toHaveProperty('intendedSellerId');
    expect(parsed).not.toHaveProperty('shortlistState');
    expect(parsed).not.toHaveProperty('price');
  });
});

describe('shortlistCandidateCommandSchema', () => {
  const VALID = {
    supplier: 'CJ_DROPSHIPPING',
    externalProductId: 'CJLY1',
    intendedSellerId: 'seller-001',
    intendedMarketCodes: ['PH'],
    actorId: 'dev-user',
  };

  it('accepts a fully server-assembled command', () => {
    expect(() => shortlistCandidateCommandSchema.parse(VALID)).not.toThrow();
  });

  it('rejects a non-CJ supplier', () => {
    expect(() =>
      shortlistCandidateCommandSchema.parse({ ...VALID, supplier: 'SHOPIFY' }),
    ).toThrow();
  });

  it('rejects an empty market list', () => {
    expect(() =>
      shortlistCandidateCommandSchema.parse({
        ...VALID,
        intendedMarketCodes: [],
      }),
    ).toThrow();
  });
});
