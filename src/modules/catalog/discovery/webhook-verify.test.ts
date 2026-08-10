import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';
import verifyCjWebhookSignature from './webhook-verify';

const SECRET = '28305';
const BODY = Buffer.from(
  JSON.stringify({ messageId: 'm-1', type: 'PRODUCT', params: { pid: 'p1' } }),
  'utf8',
);

function sign(body: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64');
}

describe('verifyCjWebhookSignature', () => {
  it('accepts the documented Base64 HMAC-SHA256 over the exact raw body', () => {
    expect(
      verifyCjWebhookSignature({
        rawBody: BODY,
        signatureHeader: sign(BODY, SECRET),
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it('rejects a signature computed with a different secret', () => {
    expect(
      verifyCjWebhookSignature({
        rawBody: BODY,
        signatureHeader: sign(BODY, 'wrong-secret'),
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it('rejects when even one raw byte differs - a reserialized body can never verify', () => {
    const reserialized = Buffer.from(`${BODY.toString('utf8')} `, 'utf8');

    expect(
      verifyCjWebhookSignature({
        rawBody: reserialized,
        signatureHeader: sign(BODY, SECRET),
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it('handles a length-mismatched signature safely (no throw, no acceptance)', () => {
    expect(
      verifyCjWebhookSignature({
        rawBody: BODY,
        signatureHeader: 'short',
        secret: SECRET,
      }),
    ).toBe(false);
    expect(
      verifyCjWebhookSignature({
        rawBody: BODY,
        signatureHeader: `${sign(BODY, SECRET)}extra-bytes-far-past-the-real-length`,
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it('fails closed on an empty signature or empty secret', () => {
    expect(
      verifyCjWebhookSignature({
        rawBody: BODY,
        signatureHeader: '',
        secret: SECRET,
      }),
    ).toBe(false);
    expect(
      verifyCjWebhookSignature({
        rawBody: BODY,
        signatureHeader: sign(BODY, SECRET),
        secret: '',
      }),
    ).toBe(false);
  });
});
