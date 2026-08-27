// @vitest-environment node
import { describe, expect, it } from 'vitest';
import describeRefusedUploads from './describe-refused-uploads';

const LIMIT_MESSAGE =
  'Product media is full at 12 photos. Delete one, or add this as a variation photo instead.';

describe('describeRefusedUploads', () => {
  it('says nothing when nothing was refused', () => {
    expect(describeRefusedUploads([], 12)).toBe('');
  });

  it('leads with the count of both halves, which is the fact the old per-file toasts never stated', () => {
    const refused = Array.from({ length: 9 }, (_, index) => ({
      name: `National_Flag_01${index}.jpg`,
      message: LIMIT_MESSAGE,
    }));

    const summary = describeRefusedUploads(refused, 12);

    expect(summary).toContain('9 of 21 photos were not uploaded.');
  });

  it('groups one repeated reason instead of repeating it per file', () => {
    const refused = [
      { name: 'a.jpg', message: LIMIT_MESSAGE },
      { name: 'b.jpg', message: LIMIT_MESSAGE },
      { name: 'c.jpg', message: LIMIT_MESSAGE },
    ];

    const summary = describeRefusedUploads(refused, 12);

    // The sentence appears once, and the three files are named against it.
    expect(summary.split(LIMIT_MESSAGE)).toHaveLength(2);
    expect(summary).toContain('a.jpg, b.jpg and c.jpg');
  });

  it('keeps two different reasons apart, each with its own files', () => {
    const summary = describeRefusedUploads(
      [
        { name: 'huge.jpg', message: 'That photo is too large.' },
        { name: 'notes.pdf', message: 'Only JPEG, PNG, and WebP.' },
      ],
      1,
    );

    expect(summary).toContain('That photo is too large. Not stored: huge.jpg.');
    expect(summary).toContain(
      'Only JPEG, PNG, and WebP. Not stored: notes.pdf.',
    );
  });

  it('states plainly when the whole batch failed', () => {
    const summary = describeRefusedUploads(
      [
        { name: 'a.jpg', message: LIMIT_MESSAGE },
        { name: 'b.jpg', message: LIMIT_MESSAGE },
      ],
      0,
    );

    expect(summary).toContain('None of the 2 photos were uploaded.');
  });

  it('caps the list and counts the remainder rather than printing thirty names', () => {
    const refused = Array.from({ length: 12 }, (_, index) => ({
      name: `photo-${index}.jpg`,
      message: LIMIT_MESSAGE,
    }));

    const summary = describeRefusedUploads(refused, 0);

    expect(summary).toContain('and 4 more.');
    expect(summary).not.toContain('photo-8.jpg');
  });

  it('truncates a pathological filename so it cannot push the reason offscreen', () => {
    const summary = describeRefusedUploads(
      [{ name: `${'x'.repeat(300)}.jpg`, message: LIMIT_MESSAGE }],
      0,
    );

    expect(summary).toContain('…');
    expect(summary.length).toBeLessThan(LIMIT_MESSAGE.length + 120);
  });

  it('names an empty filename rather than leaving a blank in the sentence', () => {
    const summary = describeRefusedUploads(
      [{ name: '   ', message: LIMIT_MESSAGE }],
      0,
    );

    expect(summary).toContain('Unnamed file');
  });
});
