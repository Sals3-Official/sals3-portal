import { z } from 'zod';

/**
 * Internal credential bundle stored (encrypted) per connection. Never sent
 * to a Client Component - see `postgres-supplier-secret-store.ts`, the only
 * module that reads or writes it.
 *
 * `accessToken`/`refreshToken` max length verified live 2026-08-07 against
 * the real CJ API: observed at 593/594 characters, well past a
 * documentation-typical assumption of ~500 - bounded generously rather than
 * tightly, since CJ controls the format and length.
 */
export const cjCredentialBundleSchema = z.object({
  apiKey: z.string().min(1).max(200),
  openId: z.union([z.string(), z.number()]).transform(String),
  accessToken: z.string().min(1).max(2000),
  accessTokenExpiresAt: z.string().datetime({ offset: true }),
  refreshToken: z.string().min(1).max(2000),
  refreshTokenExpiresAt: z.string().datetime({ offset: true }),
});

export type CjCredentialBundle = z.infer<typeof cjCredentialBundleSchema>;
