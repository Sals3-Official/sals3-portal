import { afterEach, describe, expect, it } from 'vitest';
import isDiscoveryControlAuthorized from './control-auth';

const ORIGINAL = process.env.DISCOVERY_CONTROL_SECRET;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.DISCOVERY_CONTROL_SECRET;
  } else {
    process.env.DISCOVERY_CONTROL_SECRET = ORIGINAL;
  }
});

describe('isDiscoveryControlAuthorized', () => {
  it('accepts the exact dedicated control secret', () => {
    process.env.DISCOVERY_CONTROL_SECRET = 'control-secret-1';

    expect(isDiscoveryControlAuthorized('Bearer control-secret-1')).toBe(true);
  });

  it('rejects a wrong secret, a truncated secret, and an over-long secret (length-mismatch safe)', () => {
    process.env.DISCOVERY_CONTROL_SECRET = 'control-secret-1';

    expect(isDiscoveryControlAuthorized('Bearer wrong')).toBe(false);
    expect(isDiscoveryControlAuthorized('Bearer control-secret')).toBe(false);
    expect(
      isDiscoveryControlAuthorized('Bearer control-secret-1-and-more'),
    ).toBe(false);
  });

  it('rejects a missing header', () => {
    process.env.DISCOVERY_CONTROL_SECRET = 'control-secret-1';

    expect(isDiscoveryControlAuthorized(null)).toBe(false);
  });

  it('fails closed when the secret is unset or blank', () => {
    delete process.env.DISCOVERY_CONTROL_SECRET;
    expect(isDiscoveryControlAuthorized('Bearer anything')).toBe(false);

    process.env.DISCOVERY_CONTROL_SECRET = '   ';
    expect(isDiscoveryControlAuthorized('Bearer    ')).toBe(false);
  });
});
