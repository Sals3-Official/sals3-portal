import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  productFormSchema,
  readProductForm,
  toProductInput,
} from './form-schema';
import { productInputSchema } from './schemas';

function validForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  const values: Record<string, string> = {
    name: 'Quiet tower air cooler',
    description:
      'A tall cooler that moves air quietly. The box holds the cooler and a remote.',
    category: 'home-living',
    brand: 'casapura',
    regularPrice: '2499.00',
    salePrice: '1999.00',
    costPrice: '1420.00',
    discountStartsAt: '2026-08-01',
    discountEndsAt: '2026-08-31',
    sku: 'TOWER-COOLER-01',
    upc: '',
    ean: '',
    barcode: 'SALS3-00001',
    weightGrams: '5400',
    lengthMm: '300',
    widthMm: '300',
    heightMm: '900',
    shippingClass: 'bulky',
    restrictedRegions: 'Batanes, Tawi-Tawi',
    published: 'on',
    seoTitle: 'Quiet tower air cooler',
    seoDescription: 'A quiet tower cooler for hot rooms.',
    slug: 'quiet-tower-air-cooler',
    variants: JSON.stringify([
      {
        id: 'v1',
        options: { Model: 'Standard' },
        sku: 'TOWER-COOLER-01-1',
        priceMinor: 199900,
        stock: 12,
      },
    ]),
    media: '[]',
    ...overrides,
  };

  Object.entries(values).forEach(([key, value]) => form.set(key, value));
  form.append('channels', 'web');

  return form;
}

function parse(form: FormData) {
  return productFormSchema.safeParse(readProductForm(form));
}

/** The same shape the form UI reads: one message list per form field name. */
function fieldErrorsOf(
  error: z.ZodError,
): Record<string, string[] | undefined> {
  return z.flattenError(error).fieldErrors;
}

describe('productFormSchema', () => {
  it('accepts a complete form and reads prices as centavos', () => {
    const result = parse(validForm());

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.regularPrice).toBe(249900);
      expect(result.data.salePrice).toBe(199900);
      expect(result.data.published).toBe(true);
      expect(result.data.restrictedRegions).toEqual(['Batanes', 'Tawi-Tawi']);
    }
  });

  it('treats an empty sale price as no sale', () => {
    const result = parse(validForm({ salePrice: '' }));

    expect(result.success && result.data.salePrice).toBe(null);
  });

  it('accepts a price written with a peso sign and a comma', () => {
    const result = parse(validForm({ regularPrice: '₱2,499.50' }));

    expect(result.success && result.data.regularPrice).toBe(249950);
  });

  it('rejects a price that is not a number', () => {
    const result = parse(validForm({ regularPrice: 'cheap' }));

    expect(result.success).toBe(false);
  });

  it('rejects a category that is not on the list', () => {
    const result = parse(validForm({ category: 'weapons' }));

    expect(result.success).toBe(false);
  });

  it('reads a missing publish switch as not published', () => {
    const form = validForm();

    form.delete('published');

    expect(parse(form).success && parse(form).data?.published).toBe(false);
  });

  it('rejects a form with no sales channel', () => {
    const form = validForm();

    form.delete('channels');

    expect(parse(form).success).toBe(false);
  });

  it('rejects broken variant JSON instead of throwing', () => {
    const result = parse(validForm({ variants: '{not json' }));

    expect(result.success).toBe(false);
  });
});

describe('toProductInput', () => {
  it('produces a value the write schema accepts', () => {
    const form = parse(validForm());

    expect(form.success).toBe(true);

    if (form.success) {
      expect(
        productInputSchema.safeParse(toProductInput(form.data)).success,
      ).toBe(true);
    }
  });

  it('refuses a sale price above the regular price, keyed to that field', () => {
    const form = parse(validForm({ salePrice: '9999.00' }));

    expect(form.success).toBe(false);

    if (!form.success) {
      expect(fieldErrorsOf(form.error).salePrice?.[0]).toBe(
        'The sale price must be lower than the regular price.',
      );
    }
  });

  it('refuses a discount window that ends before it starts', () => {
    const form = parse(
      validForm({
        discountStartsAt: '2026-08-31',
        discountEndsAt: '2026-08-01',
      }),
    );

    expect(form.success).toBe(false);

    if (!form.success) {
      expect(fieldErrorsOf(form.error).discountEndsAt).toBeDefined();
    }
  });

  it('refuses an availability window that ends before it starts', () => {
    const form = parse(
      validForm({ availableFrom: '2026-09-10', availableUntil: '2026-09-01' }),
    );

    expect(form.success).toBe(false);

    if (!form.success) {
      expect(fieldErrorsOf(form.error).availableUntil).toBeDefined();
    }
  });

  it('refuses an SKU with unsafe characters, keyed to the SKU field', () => {
    const form = parse(validForm({ sku: 'drop table;' }));

    expect(form.success).toBe(false);

    if (!form.success) {
      expect(fieldErrorsOf(form.error).sku).toBeDefined();
    }
  });

  it('refuses a UPC that is not 12 numbers', () => {
    const form = parse(validForm({ upc: '123' }));

    expect(form.success).toBe(false);

    if (!form.success) {
      expect(fieldErrorsOf(form.error).upc).toBeDefined();
    }
  });

  it('refuses a slug with spaces or capitals', () => {
    const form = parse(validForm({ slug: 'Not A Slug' }));

    expect(form.success).toBe(false);

    if (!form.success) {
      expect(fieldErrorsOf(form.error).slug).toBeDefined();
    }
  });

  it('refuses a form with no variants', () => {
    const form = parse(validForm({ variants: '[]' }));

    expect(form.success).toBe(false);

    if (!form.success) {
      expect(fieldErrorsOf(form.error).variants).toBeDefined();
    }
  });
});
