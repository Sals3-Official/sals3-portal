// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  IMAGE_MAX_DIMENSION_PX,
  IMAGE_MAX_UPLOAD_MB,
  IMAGE_UPLOAD_LIMITS_COPY,
} from './image-upload-limits';

/**
 * The seller-facing caption and the server's own ceiling are two files because
 * one of them imports `sharp` and can never reach the browser. This test is
 * what makes them one fact: raise the pipeline's limit without touching the
 * copy and this fails, rather than a caption telling a seller 5 MB while the
 * server accepts 10.
 *
 * The pipeline is read as source rather than imported. It is a `server-only`
 * module, which throws on import outside an RSC graph — every other test that
 * touches one mocks it, and a mock cannot witness the number this test exists
 * to compare.
 */
const PIPELINE_SOURCE = readFileSync(
  join(process.cwd(), 'src/modules/catalog/products/image-upload-pipeline.ts'),
  'utf8',
);

function numericConstant(name: string): number {
  const match = new RegExp(`export const ${name} = ([0-9_*\\s]+);`, 'u').exec(
    PIPELINE_SOURCE,
  );

  if (match?.[1] === undefined) {
    throw new Error(`${name} is no longer declared in image-upload-pipeline.`);
  }

  // The declarations are literal arithmetic (`5 * 1024 * 1024`), so the digits
  // and operators the regexp captured are the whole value.
  const value = match[1]
    .replace(/_/gu, '')
    .split('*')
    .map((part) => Number(part.trim()))
    .reduce((product, part) => product * part, 1);

  if (!Number.isFinite(value)) {
    throw new Error(`${name} is no longer a literal number.`);
  }

  return value;
}

describe('image upload limit copy', () => {
  it('states the same ceiling the upload pipeline enforces', () => {
    expect(IMAGE_MAX_UPLOAD_MB * 1024 * 1024).toBe(
      numericConstant('MAX_UPLOAD_BYTES'),
    );
    expect(IMAGE_MAX_DIMENSION_PX).toBe(numericConstant('MAX_DIMENSION_PX'));
  });

  it('names the dimensions, the formats and the byte ceiling', () => {
    expect(IMAGE_UPLOAD_LIMITS_COPY).toContain('2000 × 2000 px');
    expect(IMAGE_UPLOAD_LIMITS_COPY).toContain('5 MB');
    expect(IMAGE_UPLOAD_LIMITS_COPY).toContain('WebP');
  });
});
