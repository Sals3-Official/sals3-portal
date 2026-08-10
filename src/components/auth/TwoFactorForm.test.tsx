import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TwoFactorForm from './TwoFactorForm';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
  verifyTotp: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: mocks.refresh,
    replace: mocks.replace,
  }),
}));

vi.mock('@/lib/auth/client', () => ({
  default: {
    twoFactor: {
      verifyTotp: mocks.verifyTotp,
    },
  },
}));

describe('TwoFactorForm', () => {
  beforeEach(() => {
    mocks.refresh.mockClear();
    mocks.replace.mockClear();
    mocks.verifyTotp.mockReset();
  });

  it('continues through the server auth gate after verification', async () => {
    mocks.verifyTotp.mockResolvedValue({ data: {}, error: null });

    render(<TwoFactorForm next="/products" />);

    fireEvent.change(screen.getByLabelText('Authenticator code'), {
      target: { value: '123456' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith(
        '/auth/continue?next=%2Fproducts',
      );
    });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('reports a stale two-factor challenge without exposing internals', async () => {
    mocks.verifyTotp.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_TWO_FACTOR_COOKIE', status: 401 },
    });

    render(<TwoFactorForm />);

    fireEvent.change(screen.getByLabelText('Authenticator code'), {
      target: { value: '123456' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Verify' }));

    await screen.findByText(
      'Your verification session expired. Sign in again to continue.',
    );
  });
});
