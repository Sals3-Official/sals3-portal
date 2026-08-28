export const CJ_BASE_URL = 'https://developers.cjdropshipping.com/api2.0/v1';

export const CJ_PAGE_SIZE = 20;

export type CjErrorReason =
  | 'missing-credentials'
  | 'authentication-failed'
  | 'rate-limited'
  | 'upstream-unavailable'
  | 'unexpected-response';

/**
 * CJ's own `code` and `message` from a rejected envelope.
 *
 * Server-side only. Nothing in `CJ_ERROR_MESSAGES` is derived from it and no
 * screen reads it - it exists so a log line and a stored step snapshot can say
 * *why* CJ refused, and so callers can tell "no such order" from "something
 * broke". The five `CjErrorReason` codes remain the whole user-facing
 * vocabulary.
 */
export type CjErrorDetail = {
  code?: number;
  message?: string;
};

/**
 * Error from the CJ integration.
 *
 * It carries a short reason code, never an upstream body, stack, or URL. The
 * screen turns the code into one plain sentence, and the detail stays in the
 * server log - a response must not leak upstream internals or credentials.
 *
 * `detail` was added on 2026-08-28. Until then CJ's answer was parsed and then
 * dropped, so a supplier order that CJ had refused for a nameable reason
 * arrived as a bare `unexpected-response`, and diagnosing one meant opening a
 * database console. Optional, so every existing construction site is unchanged.
 */
export class CjApiError extends Error {
  readonly reason: CjErrorReason;

  readonly detail: CjErrorDetail | undefined;

  constructor(reason: CjErrorReason, detail?: CjErrorDetail) {
    super(reason);
    this.name = 'CjApiError';
    this.reason = reason;
    this.detail = detail;
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
