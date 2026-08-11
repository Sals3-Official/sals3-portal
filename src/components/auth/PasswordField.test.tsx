import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PasswordField from './PasswordField';

describe('PasswordField', () => {
  it('toggles visibility without clearing the value or submitting the form', () => {
    const handleSubmit = vi.fn((event: React.FormEvent) =>
      event.preventDefault(),
    );

    render(
      <form onSubmit={handleSubmit}>
        <PasswordField
          id="pw"
          name="password"
          label="Password"
          autoComplete="current-password"
          errorId="pw-error"
        />
      </form>,
    );

    const input = screen.getByLabelText('Password') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'super-secret' } });
    expect(input.type).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input.type).toBe('text');
    expect(input.value).toBe('super-secret');

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input.type).toBe('password');
    expect(input.value).toBe('super-secret');

    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('renders the forgot password link only when a href is supplied', () => {
    const { rerender } = render(
      <PasswordField
        id="pw"
        name="password"
        label="Password"
        autoComplete="current-password"
        errorId="pw-error"
      />,
    );

    expect(
      screen.queryByRole('link', { name: 'Forgot password?' }),
    ).not.toBeInTheDocument();

    rerender(
      <PasswordField
        id="pw"
        name="password"
        label="Password"
        autoComplete="current-password"
        errorId="pw-error"
        forgotPasswordHref="/reset-password"
      />,
    );

    expect(
      screen.getByRole('link', { name: 'Forgot password?' }),
    ).toHaveAttribute('href', '/reset-password');
  });

  it('associates the error message with the input for assistive tech', () => {
    render(
      <PasswordField
        id="pw"
        name="password"
        label="Password"
        autoComplete="current-password"
        errorId="pw-error"
        errorMessage="Enter your password."
      />,
    );

    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'pw-error');
    expect(screen.getByText('Enter your password.')).toHaveAttribute(
      'id',
      'pw-error',
    );
  });
});
