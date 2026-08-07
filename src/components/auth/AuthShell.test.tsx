import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AuthShell from './AuthShell';

describe('AuthShell', () => {
  it('renders the form-first authentication shell', () => {
    render(
      <AuthShell title="Sign in" description="Use your seller email.">
        <span>Email</span>
        <input aria-label="Email" />
      </AuthShell>,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Sign in' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByAltText('Sals3')).toBeInTheDocument();
  });
});
