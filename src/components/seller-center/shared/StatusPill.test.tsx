import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import StatusPill from './StatusPill';

describe('StatusPill', () => {
  it('renders the label as visible text, not just a colour', () => {
    render(<StatusPill label="Sync failed" tone="danger" />);

    expect(screen.getByText('Sync failed')).toBeInTheDocument();
  });

  it('maps each tone to a distinct surface class', () => {
    render(<StatusPill label="Ready" tone="info" />);
    expect(screen.getByText('Ready')).toHaveClass('bg-brand-100');
  });
});
