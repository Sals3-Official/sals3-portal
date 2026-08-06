import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DisclosureBanner from './DisclosureBanner';

describe('DisclosureBanner', () => {
  it('renders its children', () => {
    render(<DisclosureBanner>Estimates can change.</DisclosureBanner>);

    expect(screen.getByText('Estimates can change.')).toBeInTheDocument();
  });

  it('defaults to the info tone', () => {
    render(<DisclosureBanner>Note</DisclosureBanner>);

    expect(screen.getByText('Note')).toHaveClass('bg-muted');
  });

  it('applies the warning tone when asked', () => {
    render(<DisclosureBanner tone="warning">Careful</DisclosureBanner>);

    expect(screen.getByText('Careful')).toHaveClass('bg-warning-surface');
  });
});
