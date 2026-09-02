import getDb from '@/lib/db/client';
import planSizeChartAppend, {
  type ChartAppendPlan,
} from './append-size-chart-plan';
import { sizesOnSale } from './description-copy-guard';
import {
  DESCRIPTION_DOCUMENT_VERSION,
  descriptionDocumentSchema,
  type DescriptionDocument,
} from './description-document';
import { findProductEditorFixtureForSeller } from './read-model';
import {
  findOpenDraftRevision,
  findProductById,
  findRevisionOfProduct,
} from './repository';
import saveDescriptionDocument from './save-description-document';

/**
 * Append a transcribed size chart to a product's description, server-side.
 *
 * The planning rules (coverage against the picker, append-only, idempotent,
 * one chart per page) live in `append-size-chart-plan.ts`; this file is the
 * database walk around them. Two reads feed the plan and they are
 * deliberately different sources:
 *
 * - **The sizes on sale** come off the editor fixture's variants - the same
 *   builder the editor renders from, and the tenancy check in the same
 *   breath (a seller-scoped read of someone else's product is a `null`).
 * - **The document being appended to** comes off the REVISION ROW the save
 *   will target - the open draft when one exists, else the current revision,
 *   the same resolution order `resolveProductRevision` uses. Reading blocks
 *   from anywhere else risks planning against a document the save then does
 *   not edit; reading the row also preserves `mode`, which the fixture's
 *   block list does not carry - dropping it would silently flip a designed
 *   layout back to simple.
 *
 * The transcription itself never happens here. Charts arrive from a person
 * (or assistant) reading a supplier's PICTURE - "no measurements published"
 * is a result, never a licence to invent numbers.
 */

/** The plan's own refusal names, kept in one place with the walk's. */
type PlanRefusal = Extract<ChartAppendPlan, { ok: false }>['reason'];

export type AppendSizeChartResult =
  | {
      ok: false;
      reason: 'not_found' | 'invalid_table' | 'conflict' | PlanRefusal;
      detail: string[];
    }
  | {
      ok: true;
      outcome: 'already_done' | 'appended';
      revisionId: string;
      revisionVersion: number;
      sizesOnSale: string[];
      /** Sizes on sale the chart has no row for - a gap, reported. */
      warnings: string[];
    };

export default async function appendSizeChart(input: {
  productId: string;
  sellerAccountId: string;
  actorId: string;
  heading: string;
  headers: string[];
  rows: string[][];
}): Promise<AppendSizeChartResult> {
  const read = await findProductEditorFixtureForSeller(
    input.sellerAccountId,
    input.productId,
  );

  if (read === null) {
    return { ok: false, reason: 'not_found', detail: [] };
  }

  const selling = sizesOnSale(
    (read.fixture.variants ?? []).map((variant) => variant.optionLabel),
  );

  const db = getDb();
  const draft = await findOpenDraftRevision(db, input.productId);
  const revision =
    draft ??
    (await (async () => {
      const product = await findProductById(db, input.productId);

      if (product === null || product.currentRevisionId === null) return null;

      return findRevisionOfProduct(db, {
        revisionId: product.currentRevisionId,
        productId: input.productId,
      });
    })());

  if (revision === null) {
    return { ok: false, reason: 'not_found', detail: [] };
  }

  const stored = descriptionDocumentSchema.safeParse(revision.contentDocument);
  const current: DescriptionDocument = stored.success
    ? stored.data
    : { version: DESCRIPTION_DOCUMENT_VERSION, blocks: [] };

  const plan = planSizeChartAppend({
    blocks: current.blocks,
    selling,
    heading: input.heading,
    headers: input.headers,
    rows: input.rows,
  });

  if (!plan.ok) {
    return { ok: false, reason: plan.reason, detail: plan.detail };
  }

  if (plan.outcome === 'already_done') {
    return {
      ok: true,
      outcome: 'already_done',
      revisionId: revision.id,
      revisionVersion: revision.version,
      sizesOnSale: selling,
      warnings: plan.warnings,
    };
  }

  // The appended document goes through the SAME schema every other
  // description write passes - rectangularity, cell caps, markup refusal -
  // so this route cannot store a table the editor would refuse.
  const appended = descriptionDocumentSchema.safeParse({
    ...current,
    blocks: plan.blocks,
  });

  if (!appended.success) {
    return {
      ok: false,
      reason: 'invalid_table',
      detail: appended.error.issues.map((issue) => issue.message),
    };
  }

  const result = await saveDescriptionDocument({
    productId: input.productId,
    revisionId: revision.id,
    expectedRevisionVersion: revision.version,
    descriptionDocument: appended.data,
    sellerAccountId: input.sellerAccountId,
    actorId: input.actorId,
  });

  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason === 'not_found' ? 'not_found' : 'conflict',
      detail: [result.reason],
    };
  }

  return {
    ok: true,
    outcome: 'appended',
    revisionId: result.revisionId,
    revisionVersion: result.revisionVersion,
    sizesOnSale: selling,
    warnings: plan.warnings,
  };
}
