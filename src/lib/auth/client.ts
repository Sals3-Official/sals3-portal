'use client';

import { createAuthClient } from 'better-auth/react';
import { twoFactorClient } from 'better-auth/client/plugins';
import { authStepRedirect, DEFAULT_AFTER_LOGIN } from './redirect';

const AUTH_NEXT_STORAGE_KEY = 'sals3:auth-next';

function readAuthNext(): string {
  if (typeof window === 'undefined') return DEFAULT_AFTER_LOGIN;

  try {
    return (
      window.sessionStorage.getItem(AUTH_NEXT_STORAGE_KEY) ??
      DEFAULT_AFTER_LOGIN
    );
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
}

export function rememberAuthNext(next: string) {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(AUTH_NEXT_STORAGE_KEY, next);
  } catch {
    // Storage can be disabled; the server continuation still falls back safely.
  }
}

export function clearAuthNext() {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.removeItem(AUTH_NEXT_STORAGE_KEY);
  } catch {
    // Storage can be disabled; nothing security-sensitive lives here.
  }
}

const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect: () => {
        if (typeof window === 'undefined') return;

        const next = readAuthNext();
        clearAuthNext();
        window.location.assign(authStepRedirect('/two-factor', next));
      },
    }),
  ],
});

export default authClient;
