import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginForm from './LoginForm';

const mocks = vi.hoisted(() => ({
  clearAuthNext: vi.fn(),
  refresh: vi.fn(),
  rememberAuthNext: vi.fn(),
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
  signInEmail: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: mocks.refresh,
    replace: mocks.replace,
  }),
  useSearchParams: () => mocks.searchParams,
}));

vi.mock('@/lib/auth/client', () => ({
  clearAuthNext: mocks.clearAuthNext,
  default: {
    signIn: {
      email: mocks.signInEmail,
    },
  },
  rememberAuthNext: mocks.rememberAuthNext,
}));

describe('LoginForm', () => {
  beforeEach(() => {
    mocks.clearAuthNext.mockClear();
    mocks.refresh.mockClear();
    mocks.rememberAuthNext.mockClear();
    mocks.replace.mockClear();
    mocks.searchParams = new URLSearchParams();
    mocks.signInEmail.mockReset();
  });

  it('continues through the server auth gate after a completed password sign-in', async () => {
    mocks.searchParams = new URLSearchParams({ next: '/orders' });
    mocks.signInEmail.mockResolvedValue({ data: {}, error: null });

    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'seller@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(mocks.signInEmail).toHaveBeenCalledWith({
        email: 'seller@example.com',
        password: 'correct horse battery staple',
        rememberMe: true,
      });
    });

    expect(mocks.rememberAuthNext).toHaveBeenCalledWith('/orders');
    expect(mocks.clearAuthNext).toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith('/auth/continue?next=%2Forders');
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('routes a two-factor challenge to the TOTP page with the intended route', async () => {
    mocks.searchParams = new URLSearchParams({ next: '/payouts' });
    mocks.signInEmail.mockResolvedValue({
      data: { twoFactorRedirect: true },
      error: null,
    });

    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'seller@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith('/two-factor?next=%2Fpayouts');
    });
  });
});
