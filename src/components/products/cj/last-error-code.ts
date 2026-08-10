import { CJ_ERROR_MESSAGES, type CjErrorReason } from '@/services/cj/config';
import { CONNECTION_PAUSE_ERROR_CODES } from '@/modules/catalog/candidates/connection-pause';

const CONNECTION_PAUSE_LABELS: Record<string, string> = {
  [CONNECTION_PAUSE_ERROR_CODES.PENDING]:
    'The supplier connection is still being verified.',
  [CONNECTION_PAUSE_ERROR_CODES.REAUTH_REQUIRED]:
    'The supplier connection needs reauthorization in Supplier Apps.',
  [CONNECTION_PAUSE_ERROR_CODES.DISCONNECTED]:
    'The supplier connection is disconnected. Reconnect in Supplier Apps to resume.',
  [CONNECTION_PAUSE_ERROR_CODES.REVOKED]:
    'The supplier connection was revoked. Reconnect in Supplier Apps to resume.',
};

const DATA_ERROR_LABELS: Record<string, string> = {
  no_supplier_connection:
    'This candidate has no supplier connection on record.',
  connection_unavailable: 'The supplier connection could not be found.',
};

function isCjErrorReason(code: string): code is CjErrorReason {
  return code in CJ_ERROR_MESSAGES;
}

/**
 * Turns a `candidate_evaluations.last_error_code` into one plain sentence,
 * matching `REASON_CODE_EXPLANATIONS`'s pattern for decision reason codes -
 * a seller should never see a raw code like
 * `SUPPLIER_CONNECTION_DISCONNECTED` or `upstream-unavailable` with no
 * explanation. Falls back to the raw code rather than hiding it, since an
 * unmapped code is more useful visible than silently swallowed.
 */
export default function explainLastErrorCode(code: string | null): string {
  if (code === null) return 'Unknown error.';
  if (code in CONNECTION_PAUSE_LABELS) return CONNECTION_PAUSE_LABELS[code];
  if (code in DATA_ERROR_LABELS) return DATA_ERROR_LABELS[code];
  if (isCjErrorReason(code)) return CJ_ERROR_MESSAGES[code];

  return code;
}
