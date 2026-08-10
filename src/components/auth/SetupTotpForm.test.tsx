import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SetupTotpForm from './SetupTotpForm';

const mocks = vi.hoisted(() => ({
  enable: vi.fn(),
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
      enable: mocks.enable,
      verifyTotp: mocks.verifyTotp,
    },
  },
}));

describe('SetupTotpForm', () => {
  beforeEach(() => {
    mocks.enable.mockReset();
    mocks.refresh.mockClear();
    mocks.replace.mockClear();
    mocks.verifyTotp.mockReset();
  });

  it('shows a password-specific setup failure', async () => {
    mocks.enable.mockResolvedValue({
      data: null,
      error: { status: 400 },
    });

    render(<SetupTotpForm />);

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'wrong-password' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Create authenticator setup' }),
    );

    await screen.findByText(
      'Two-factor setup could not start. Check your password.',
    );
  });

  it('continues through the server auth gate after successful verification', async () => {
    mocks.enable.mockResolvedValue({
      data: {
        backupCodes: ['backup-1111'],
        totpURI: 'otpauth://totp/Sals3:test?secret=ABC',
      },
      error: null,
    });
    mocks.verifyTotp.mockResolvedValue({ data: {}, error: null });

    render(<SetupTotpForm next="/orders" />);

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Create authenticator setup' }),
    );

    await screen.findByText('Backup codes');

    fireEvent.change(screen.getByLabelText('Authenticator code'), {
      target: { value: '123456' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Verify two-factor' }));

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith(
        '/auth/continue?next=%2Forders',
      );
    });
    expect(mocks.refresh).toHaveBeenCalled();
  });
});
