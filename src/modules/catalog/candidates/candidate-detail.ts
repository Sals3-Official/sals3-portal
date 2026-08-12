import type { CandidateEvidence } from '@/lib/cj/evidence';
import type {
  AuditEventRow,
  CandidateDiscoverySignalRow,
  CandidateEvaluationRow,
  CandidateStockAttestationRow,
  PricingProductOverrideRow,
  PricingVariantOverrideRow,
  ProviderProductReferenceRow,
  SupplierCandidateRow,
} from '@/lib/db/schema';
import type { EvidenceSummary, FeedSnapshot } from './rules/contracts';

/**
 * Everything the database holds about ONE supplier candidate, for the read-only
 * detail drawer on Product Sourcing.
 *
 * Types only - no `getDb` import - so component tests can build a fixture from
 * this file without reaching a database client.
 *
 * ## What is actually populated
 *
 * Measured against production 2026-08-12 (see `candidate-view.ts`): 19 of
 * 87,966 candidates had a captured `supplier_snapshots` row, while 87,966 of
 * 87,966 evaluations carried a real `feed_snapshot`. So `snapshot` is null on
 * essentially every candidate a reviewer will open, and the drawer must say
 * "never fetched" rather than let an empty section read as "CJ reported
 * nothing". `feedSnapshot` and `evaluation` are the fields that always exist.
 *
 * ## Deliberately absent
 *
 * `category_remap_review_findings` is not read here. Its `supplierCandidateId`
 * is nullable and, per that table's own schema comment, null today, with
 * `affectedCandidatesEnumerated` defaulting to false - "blast radius recorded,
 * not listed". A per-candidate section would therefore render an empty state on
 * 100% of candidates, which is exactly the false reassurance that comment
 * forbids. Revisit when per-candidate enumeration ships.
 */
export type CandidateDetail = {
  candidate: SupplierCandidateRow;
  /** The owning connection, already proven to belong to the reading seller. */
  connection: { id: string; status: string };
  /** Null when the candidate was discovered but never queued for evaluation. */
  evaluation: CandidateEvaluationRow | null;
  /** `safeParse`d from jsonb - null means unparseable, not merely absent. */
  feedSnapshot: FeedSnapshot | null;
  evidenceSummary: EvidenceSummary | null;
  /** Null means CJ detail evidence was NEVER fetched - the 87,947 case. */
  snapshot: {
    schemaVersion: string;
    checksum: string;
    capturedAt: Date;
    evidence: CandidateEvidence;
  } | null;
  attestations: CandidateStockAttestationRow[];
  discoverySignals: CandidateDiscoverySignalRow[];
  productOverrides: PricingProductOverrideRow[];
  variantOverrides: PricingVariantOverrideRow[];
  auditEvents: AuditEventRow[];
  productReferences: ProviderProductReferenceRow[];
};
