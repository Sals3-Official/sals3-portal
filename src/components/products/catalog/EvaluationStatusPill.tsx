import StatusPill from '@/components/seller-center/shared/StatusPill';
import { presentEvaluationStatus } from '@/lib/products/catalog-presentation';
import type { EvaluationStatus } from '@/lib/products/catalog-types';

type EvaluationStatusPillProps = {
  status: EvaluationStatus | null;
};

/**
 * Read-only - the automated pipeline produced this decision, not the seller,
 * so unlike the old per-row "Check for Sals3" button there is nothing to
 * click here. Opening detail is the row's job (spec section 9's details
 * drawer), not the pill's.
 */
export default function EvaluationStatusPill({
  status,
}: EvaluationStatusPillProps) {
  const presentation = presentEvaluationStatus(status);

  return <StatusPill label={presentation.label} tone={presentation.tone} />;
}
