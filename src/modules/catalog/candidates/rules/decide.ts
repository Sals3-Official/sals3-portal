import {
  PERMANENT_REASON_CODES,
  type EvaluationStatus,
  type ReasonCode,
  type RuleFinding,
} from './contracts';

export type Decision = {
  status: EvaluationStatus;
  reasonCodes: ReasonCode[];
};

/**
 * Combines rule findings into one decision, conservative by design (spec
 * section 11.1: "Yellow never contains an unresolved ... blocker"). A single
 * `BLOCK` finding is enough to fail the candidate; whether that means
 * `BLOCKED` (permanent, no override) or `TEMPORARILY_INELIGIBLE` (auto-retried)
 * depends on whether ANY blocking reason is permanent - one permanent issue
 * makes the whole candidate permanently blocked even alongside a transient
 * one. Duplicate reason codes are kept once each so the Blocked/Rejected page
 * does not show the same reason twice when both cheap screening and full
 * qualification flagged it.
 */
export function decide(findings: RuleFinding[]): Decision {
  const blocking = findings.filter((finding) => finding.severity === 'BLOCK');
  const attention = findings.filter(
    (finding) => finding.severity === 'ATTENTION',
  );

  if (blocking.length > 0) {
    const reasonCodes = [
      ...new Set(blocking.map((finding) => finding.reasonCode)),
    ];
    const hasPermanentReason = reasonCodes.some((code) =>
      PERMANENT_REASON_CODES.includes(code),
    );

    return {
      status: hasPermanentReason ? 'BLOCKED' : 'TEMPORARILY_INELIGIBLE',
      reasonCodes,
    };
  }

  if (attention.length > 0) {
    return {
      status: 'PASS_WITH_ATTENTION',
      reasonCodes: [...new Set(attention.map((finding) => finding.reasonCode))],
    };
  }

  return { status: 'PASS', reasonCodes: [] };
}
