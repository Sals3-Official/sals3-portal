import { describe, expect, it } from 'vitest';
import { loginSchema, signupSchema, totpCodeSchema } from './schemas';

describe('auth schemas', () => {
  it('normalizes signup email and accepts the two public seller models', () => {
    const result = signupSchema.parse({
      name: 'Ada Seller',
      email: 'ADA@EXAMPLE.COM',
      password: 'correct horse battery staple',
      businessModel: 'DROPSHIPPER',
    });

    expect(result.email).toBe('ada@example.com');
    expect(result.businessModel).toBe('DROPSHIPPER');

    expect(() =>
      signupSchema.parse({
        ...result,
        businessModel: 'ADMIN',
      }),
    ).toThrow();
  });

  it('requires a long first-party password', () => {
    expect(() =>
      signupSchema.parse({
        name: 'Ada Seller',
        email: 'ada@example.com',
        password: 'short',
        businessModel: 'RETAILER',
      }),
    ).toThrow();
  });

  it('keeps login generic while still validating email shape', () => {
    const result = loginSchema.safeParse({
      email: 'bad',
      password: 'present',
    });

    expect(result.success).toBe(false);
  });

  it('accepts only six digit TOTP codes', () => {
    expect(totpCodeSchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(totpCodeSchema.safeParse({ code: '12345' }).success).toBe(false);
    expect(totpCodeSchema.safeParse({ code: 'abcdef' }).success).toBe(false);
  });
});
