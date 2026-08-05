import { describe, expect, it } from 'vitest';
import { cjProductListSchema, cjQuerySchema } from './schemas';

describe('cjQuerySchema', () => {
  it('defaults to the first page with no search word', () => {
    const query = cjQuerySchema.parse({});

    expect(query.cjPage).toBe(1);
    expect(query.cjSearch).toBe('');
  });

  it('reads a page number from the URL', () => {
    expect(cjQuerySchema.parse({ cjPage: '4' }).cjPage).toBe(4);
  });

  it('falls back instead of throwing on a bad page number', () => {
    expect(cjQuerySchema.parse({ cjPage: 'abc' }).cjPage).toBe(1);
    expect(cjQuerySchema.parse({ cjPage: '-2' }).cjPage).toBe(1);
    expect(cjQuerySchema.parse({ cjPage: '99999' }).cjPage).toBe(1);
  });

  it('trims a search word and caps its length', () => {
    expect(cjQuerySchema.parse({ cjSearch: '  lamp  ' }).cjSearch).toBe('lamp');
    expect(cjQuerySchema.parse({ cjSearch: 'x'.repeat(200) }).cjSearch).toBe(
      '',
    );
  });
});

describe('cjProductListSchema', () => {
  const validBody = {
    code: 200,
    message: 'Success',
    data: {
      pageNum: 1,
      pageSize: 20,
      total: 1495292,
      list: [
        {
          pid: 'abc',
          productName: '["名前"]',
          productNameEn: 'Lamp',
          productSku: 'CJ123',
          productImage: 'https://cf.cjdropshipping.com/a.jpg',
          productWeight: '300.00',
          productType: 'ORDINARY_PRODUCT',
          categoryName: 'Lamps',
          categoryId: 'cat-1',
          sellPrice: '5.09',
          listedNum: 3,
          supplierName: 'Someone',
          isFreeShipping: true,
          createTime: 1785921203000,
          shippingCountryCodes: ['CN'],
        },
      ],
    },
  };

  it('accepts a real response body', () => {
    const parsed = cjProductListSchema.safeParse(validBody);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.data?.list).toHaveLength(1);
  });

  it('accepts a response with no list', () => {
    const parsed = cjProductListSchema.safeParse({
      code: 200,
      message: 'Success',
      data: { pageNum: 1, pageSize: 20, total: 0, list: null },
    });

    expect(parsed.success).toBe(true);
  });

  it('accepts an error body so the caller can report the code', () => {
    const parsed = cjProductListSchema.safeParse({
      code: 401,
      message: 'Token expired',
      data: null,
    });

    expect(parsed.success && parsed.data.code).toBe(401);
  });

  it('tolerates a numeric price and a missing weight', () => {
    const parsed = cjProductListSchema.safeParse({
      ...validBody,
      data: {
        ...validBody.data,
        list: [
          { ...validBody.data.list[0], sellPrice: 5.09, productWeight: null },
        ],
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects a body with no code', () => {
    expect(cjProductListSchema.safeParse({ message: 'nope' }).success).toBe(
      false,
    );
  });
});
