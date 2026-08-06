import { createHash, timingSafeEqual } from 'crypto';
import db from '@/lib/db/client';
import {
  shortlistCandidateCommandSchema,
  type ShortlistCandidateCommand,
  type ShortlistResult,
} from './contracts';
import {
  appendAuditEvent,
  findCandidateByExternalId,
  findIdempotencyRecord,
  insertCandidateIfAbsent,
  insertIdempotencyRecordIfAbsent,
} from './repository';

/**
 * The Shortlist use case (spec section 8.1): create or reuse a
 * `SupplierCandidate`, idempotently, with an audit trail.
 *
 * This is the ONLY persisted step. It never produces a preflight decision or
 * quality score — spec section 8.3's enrichment fetch (fresh CJ detail,
 * variants, inventory, media, freight) does not exist yet, and a decision
 * without those signals would be a fabricated one.
 */

const OPERATION = 'catalog.candidate.shortlist';
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export type ShortlistOutcome =
  | { status: 'ok'; result: ShortlistResult; replayed: boolean }
  | { status: 'idempotency_conflict' };

/**
 * Canonical hash of the request payload. Only the digest is stored, never the
 * payload, so comparing two requests retains nothing sensitive.
 */
function hashCommand(command: ShortlistCandidateCommand): string {
  const canonical = JSON.stringify([
    command.supplier,
    command.externalProductId,
    command.intendedSellerId,
    [...command.intendedMarketCodes].sort(),
  ]);

  return createHash('sha256').update(canonical).digest('hex');
}

/** Constant-time digest comparison; both inputs are fixed-length hex. */
function hashesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');

  return (
    leftBuffer.length === rightBuffer.length &&
    leftBuffer.length > 0 &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export default async function shortlistCandidate(
  command: ShortlistCandidateCommand,
  idempotencyKey: string,
): Promise<ShortlistOutcome> {
  // Re-validate at the module boundary even though the caller validated:
  // this function is the last line of defence before a write.
  const parsed = shortlistCandidateCommandSchema.parse(command);
  const requestHash = hashCommand(parsed);

  return db.transaction(async (tx) => {
    const existingKey = await findIdempotencyRecord(tx, idempotencyKey);

    if (existingKey !== null) {
      if (!hashesMatch(existingKey.requestHash, requestHash)) {
        return { status: 'idempotency_conflict' };
      }

      return {
        status: 'ok',
        replayed: true,
        result: existingKey.resultReference as ShortlistResult,
      };
    }

    const created = await insertCandidateIfAbsent(tx, {
      supplier: parsed.supplier,
      externalProductId: parsed.externalProductId,
      intendedSellerId: parsed.intendedSellerId,
      intendedMarketCodes: parsed.intendedMarketCodes,
      actorId: parsed.actorId,
    });

    let result: ShortlistResult;

    if (created !== null) {
      result = {
        candidateId: created.id,
        shortlistState: created.shortlistState,
        reused: false,
      };

      await appendAuditEvent(tx, {
        actorId: parsed.actorId,
        action: 'CANDIDATE_SHORTLISTED',
        entityType: 'supplier_candidate',
        entityId: created.id,
        payload: {
          supplier: parsed.supplier,
          externalProductId: parsed.externalProductId,
          intendedSellerId: parsed.intendedSellerId,
          intendedMarketCodes: parsed.intendedMarketCodes,
        },
      });
    } else {
      // Spec section 4.2: an exact supplier-product match reopens the
      // existing record instead of creating a duplicate.
      const existing = await findCandidateByExternalId(
        tx,
        parsed.supplier,
        parsed.externalProductId,
      );

      if (existing === null) {
        throw new Error(
          'Candidate conflicted on insert but could not be read back.',
        );
      }

      result = {
        candidateId: existing.id,
        shortlistState: existing.shortlistState,
        reused: true,
      };
    }

    await insertIdempotencyRecordIfAbsent(tx, {
      key: idempotencyKey,
      actorId: parsed.actorId,
      operation: OPERATION,
      requestHash,
      resultReference: result,
      expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
    });

    return { status: 'ok', result, replayed: false };
  });
}
