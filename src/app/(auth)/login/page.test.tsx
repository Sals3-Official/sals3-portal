import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LoginPage from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

describe('LoginPage', () => {
  it('renders Sals3 Portal branding as the one h1, not Seller Center', () => {
    render(<LoginPage />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Log in to Sals3 Portal' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Sals3 Portal').length).toBeGreaterThan(0);
    expect(screen.queryByText(/seller center/i)).not.toBeInTheDocument();
  });

  it('keeps the login form as the dominant task with email and password fields', () => {
    render(<LoginPage />);

    const email = screen.getByLabelText('Email');
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('autocomplete', 'email');

    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');

    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
  });

  it('keeps working links to create an account and recover a password', () => {
    render(<LoginPage />);

    expect(
      screen.getByRole('link', { name: 'Create an account' }),
    ).toHaveAttribute('href', '/signup');
    expect(
      screen.getByRole('link', { name: 'Forgot password?' }),
    ).toHaveAttribute('href', '/reset-password');
  });

  it('excludes every unsupported prototype control', () => {
    render(<LoginPage />);

    // No Phone/Email segmented login-method tabs.
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/phone number/i)).not.toBeInTheDocument();

    // No Google/Facebook OAuth.
    expect(
      screen.queryByRole('button', { name: /google/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /facebook/i }),
    ).not.toBeInTheDocument();

    // No language selector.
    expect(
      screen.queryByRole('button', { name: /english|language/i }),
    ).not.toBeInTheDocument();

    // No fabricated metrics or ambiguous region label.
    expect(screen.queryByText(/markets live/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/supplier skus?/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/payout cycle/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/philippines/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/seller access ·/i)).not.toBeInTheDocument();
  });
});
