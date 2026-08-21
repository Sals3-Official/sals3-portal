// @vitest-environment node
import { describe, expect, it } from 'vitest';
import maskDisplayName from './display-name';
import { REVIEW_DISPLAY_NAME_MAX_LENGTH } from './contracts';

describe('maskDisplayName', () => {
  it.each([
    ['Hezekiah Aranador', 'Hezekiah A.'],
    ['  Marites   Dela Cruz  ', 'Marites C.'],
    ['jonathan reyes', 'jonathan R.'],
  ])('reduces %s to %s', (input, expected) => {
    expect(maskDisplayName(input)).toBe(expected);
  });

  /**
   * A single name gets no invented initial. Rendering "Cher C." for a buyer
   * called Cher would publish a letter they never gave us.
   */
  it('returns a single-token name whole', () => {
    expect(maskDisplayName('Cher')).toBe('Cher');
  });

  /** The anonymous case is the caller's to render, not ours to substitute. */
  it.each(['', '   ', '\t\n'])('answers null for %j', (input) => {
    expect(maskDisplayName(input)).toBeNull();
  });

  /**
   * A trailing token with no letters cannot produce a meaningful initial, so
   * the first name stands alone rather than gaining a decorative full stop.
   */
  it.each([
    ['Ana 🙂', 'Ana'],
    ['Ana ,', 'Ana'],
  ])('drops a letterless surname token (%s)', (input, expected) => {
    expect(maskDisplayName(input)).toBe(expected);
  });

  it('upper-cases the initial regardless of how it was typed', () => {
    expect(maskDisplayName('ana bautista')).toBe('ana B.');
  });

  /**
   * Non-Latin scripts have no case distinction, and `toLocaleUpperCase` must
   * leave them intact rather than mangling the one character we publish.
   */
  it('keeps a non-Latin initial as written', () => {
    expect(maskDisplayName('Мария Иванова')).toBe('Мария И.');
  });

  /** The column's CHECK caps this, so a long name is cut, never rejected. */
  it('truncates to the column limit instead of refusing the review', () => {
    const long = 'A'.repeat(200);
    const masked = maskDisplayName(`${long} Smith`);

    expect(masked).not.toBeNull();
    expect(Array.from(masked ?? '')).toHaveLength(
      REVIEW_DISPLAY_NAME_MAX_LENGTH,
    );
  });

  /** Counts code points, so an emoji-heavy name cannot be cut mid-character. */
  it('truncates by code point, not by UTF-16 unit', () => {
    const masked = maskDisplayName('👩‍🔬'.repeat(60));

    expect(Array.from(masked ?? '').length).toBeLessThanOrEqual(
      REVIEW_DISPLAY_NAME_MAX_LENGTH,
    );
  });
});
