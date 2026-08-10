import { createHash, createHmac, timingSafeEqual } from 'crypto';

/**
 * CJ webhook signature verification, exactly as documented: the `sign`
 * header carries `Base64(HmacSHA256(secret = openId string, message = raw
 * request body bytes))`. Verification runs over the EXACT raw bytes -
 * never a deserialized/reserialized body - and compares in constant time
 * with safe handling of length mismatches (both sides are hashed to a
 * fixed width first, so unequal lengths can neither throw nor leak timing).
 */
export default function verifyCjWebhookSignature(input: {
  rawBody: Buffer;
  signatureHeader: string;
  secret: string;
}): boolean {
  if (input.signatureHeader === '' || input.secret === '') return false;

  const expected = createHmac('sha256', input.secret)
    .update(input.rawBody)
    .digest('base64');

  // Hash both values to a fixed length before comparing: timingSafeEqual
  // requires equal-length buffers, and this keeps the comparison constant
  // time even when an attacker sends a wrong-length signature.
  const expectedDigest = createHash('sha256').update(expected).digest();
  const providedDigest = createHash('sha256')
    .update(input.signatureHeader)
    .digest();

  return timingSafeEqual(expectedDigest, providedDigest);
}
