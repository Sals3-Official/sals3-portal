import { timingSafeEqual } from 'crypto';

const PREFIX = 'Bearer ';

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export default function isStorefrontRequestAuthorized(
  request: Request,
): boolean {
  const token = process.env.SALS3_STOREFRONT_API_TOKEN;
  const authorization = request.headers.get('authorization') ?? '';

  if (
    token === undefined ||
    token === '' ||
    !authorization.startsWith(PREFIX)
  ) {
    return false;
  }

  return safeEqual(authorization.slice(PREFIX.length), token);
}
