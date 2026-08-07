export const CJ_BASE_URL = 'https://developers.cjdropshipping.com/api2.0/v1';

export const CJ_PAGE_SIZE = 20;

export type CjErrorReason =
  | 'missing-credentials'
  | 'authentication-failed'
  | 'rate-limited'
  | 'upstream-unavailable'
  | 'unexpected-response';

/**
 * Error from the CJ integration.
 *
 * It carries a short reason code, never an upstream body, stack, or URL. The
 * screen turns the code into one plain sentence, and the detail stays in the
 * server log - a response must not leak upstream internals or credentials.
 */
export class CjApiError extends Error {
  readonly reason: CjErrorReason;

  constructor(reason: CjErrorReason) {
    super(reason);
    this.name = 'CjApiError';
    this.reason = reason;
  }
}

export const CJ_ERROR_MESSAGES: Record<CjErrorReason, string> = {
  'missing-credentials':
    'No usable CJdropshipping supplier connection exists. Connect one from Supplier Apps (or run npm run bootstrap:cj for the Sals3 Official account).',
  'authentication-failed':
    'CJdropshipping refused the API key. Check that the key is correct and still active.',
  'rate-limited':
    'CJdropshipping is limiting requests right now. Wait a moment and try again.',
  'upstream-unavailable':
    'CJdropshipping did not answer. Try again in a moment.',
  'unexpected-response':
    'CJdropshipping sent something this page could not read. Try again in a moment.',
};
