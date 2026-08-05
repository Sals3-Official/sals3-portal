import { describe, expect, it } from 'vitest';
import {
  formatUsdCents,
  formatWeight,
  normalizeCjProduct,
  toIsoDate,
  usdToCents,
} from './normalize';
import { cjProductSchema } from './schemas';

/** A real row from the CJ product list, kept verbatim as the test fixture. */
const RAW_PRODUCT = {
  pid: '2608050913231629400',
  productName:
    '["欧美跨境夏季新款豹纹抽绳休闲裤女宽松直筒阔腿裤时尚百搭长裤","第二个名字"]',
  productNameEn:
    'Womens Relaxed-fit Casual Leopard-print Drawstring Sweatpants',
  productSku: 'CJKT3038809',
  productImage:
    'https://cf.cjdropshipping.com/quick/product/66be425f-7a6c-483f-889b-ff43c4d9bb2d.jpg',
  productWeight: '300.00-340.00',
  productType: 'ORDINARY_PRODUCT',
  categoryName: 'Wide Leg Pants',
  categoryId: 'A7DE167B-ECFF-481E-A52A-2E7937BFAA95',
  sellPrice: '5.09',
  listedNum: 0,
  supplierName: null,
  isFreeShipping: false,
  createTime: 1785921203000,
  shippingCountryCodes: ['CN', 'CN_US'],
};

function parse(overrides: Record<string, unknown> = {}) {
  const result = cjProductSchema.safeParse({ ...RAW_PRODUCT, ...overrides });

  if (!result.success) {
    throw new Error(`Fixture failed to parse: ${result.error.message}`);
  }

  return normalizeCjProduct(result.data);
}

describe('usdToCents', () => {
  it('reads a price string as cents', () => {
    expect(usdToCents('5.09')).toBe(509);
    expect(usdToCents('12')).toBe(1200);
  });

  it('returns null for an unusable price', () => {
    expect(usdToCents('')).toBe(null);
    expect(usdToCents('free')).toBe(null);
    expect(usdToCents('-3.00')).toBe(null);
  });
});

describe('formatUsdCents', () => {
  it('shows dollars with two decimal places', () => {
    expect(formatUsdCents(509)).toBe('$5.09');
    expect(formatUsdCents(120000)).toBe('$1,200.00');
  });

  it('shows a dash when there is no price', () => {
    expect(formatUsdCents(null)).toBe('—');
  });
});

describe('toIsoDate', () => {
  it('turns epoch milliseconds into a plain date', () => {
    expect(toIsoDate(1785921203000)).toBe('2026-08-05');
  });

  it('returns null for a missing or impossible value', () => {
    expect(toIsoDate(null)).toBe(null);
    expect(toIsoDate(0)).toBe(null);
  });
});

describe('formatWeight', () => {
  it('keeps a range and adds the unit', () => {
    expect(formatWeight('300.00-340.00')).toBe('300.00-340.00 g');
  });

  it('shows a dash when the weight is missing', () => {
    expect(formatWeight('')).toBe('—');
  });
});

describe('normalizeCjProduct', () => {
  it('maps a real supplier row', () => {
    const product = parse();

    expect(product.id).toBe('2608050913231629400');
    expect(product.name).toBe(RAW_PRODUCT.productNameEn);
    expect(product.sku).toBe('CJKT3038809');
    expect(product.priceCentsUsd).toBe(509);
    expect(product.category).toBe('Wide Leg Pants');
    expect(product.shipsFrom).toEqual(['CN', 'CN_US']);
    expect(product.createdAt).toBe('2026-08-05');
  });

  it('falls back to the first local name when the English name is missing', () => {
    const product = parse({ productNameEn: '' });

    expect(product.name).toBe(
      '欧美跨境夏季新款豹纹抽绳休闲裤女宽松直筒阔腿裤时尚百搭长裤',
    );
  });

  it('survives a name that is not JSON', () => {
    const product = parse({ productNameEn: '', productName: 'Plain name' });

    expect(product.name).toBe('Plain name');
  });

  it('never leaves a product without a readable name', () => {
    const product = parse({ productNameEn: '', productName: '' });

    expect(product.name).toBe('Unnamed product');
  });

  it('shows a dash instead of an empty supplier or SKU', () => {
    const product = parse({ supplierName: null, productSku: '' });

    expect(product.supplier).toBe('—');
    expect(product.sku).toBe('—');
  });

  it('drops an image address from a host that is not allow-listed', () => {
    const product = parse({ productImage: 'https://evil.example.com/a.jpg' });

    expect(product.imageUrl).toBe(null);
  });

  it('drops an image address that is not https', () => {
    const product = parse({
      productImage: 'http://cf.cjdropshipping.com/a.jpg',
    });

    expect(product.imageUrl).toBe(null);
  });

  it('keeps an image address from an allow-listed host', () => {
    const product = parse({
      productImage: 'https://oss-cf.cjdropshipping.com/product/a.jpg',
    });

    expect(product.imageUrl).toBe(
      'https://oss-cf.cjdropshipping.com/product/a.jpg',
    );
  });

  it('drops a malformed image address', () => {
    const product = parse({ productImage: 'not a url' });

    expect(product.imageUrl).toBe(null);
  });
});
