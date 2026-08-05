'use server';

import { z } from 'zod';
import { failure, fromThrown, success } from '@/lib/portal/action-result';
import { previewCsv } from '@/lib/products/csv';
import {
  IDLE_IMPORT,
  type ImportPreviewState,
} from '@/lib/products/import-state';
import { requirePermission } from '@/lib/auth/session';

/**
 * CSV import preview.
 *
 * The upload is checked for type and size before it is read, and the parsed
 * rows are returned for review - nothing is written to the catalogue. Applying
 * an import needs the real catalogue service, so that step is not built yet and
 * is not pretended to work.
 */

const MAX_BYTES = 1_000_000;
const ALLOWED_TYPES = ['text/csv', 'application/vnd.ms-excel', 'text/plain'];

const fileSchema = z
  .instanceof(File)
  .refine((file) => file.size > 0, 'Choose a CSV file.')
  .refine(
    (file) => file.size <= MAX_BYTES,
    'The file is larger than 1 MB. Split it into smaller files.',
  )
  .refine(
    (file) => file.name.toLowerCase().endsWith('.csv'),
    'The file name must end with .csv.',
  )
  .refine(
    (file) => file.type === '' || ALLOWED_TYPES.includes(file.type),
    'That file type is not allowed. Upload a CSV file.',
  );

export async function previewImportAction(
  _previous: ImportPreviewState,
  formData: FormData,
): Promise<ImportPreviewState> {
  try {
    await requirePermission('product:import');
  } catch (error) {
    return { ...IDLE_IMPORT, ...fromThrown(error, 'import preview') };
  }

  const parsed = fileSchema.safeParse(formData.get('file'));

  if (!parsed.success) {
    return {
      ...IDLE_IMPORT,
      ...failure(parsed.error.issues[0]?.message ?? 'Choose a CSV file.'),
    };
  }

  const preview = previewCsv(await parsed.data.text());

  if (preview.rows.length === 0) {
    return {
      ...IDLE_IMPORT,
      ...failure('No rows were read from that file.'),
      problems: preview.errors,
    };
  }

  return {
    ...success(
      `${preview.rows.length} rows read. Review them below. Import is not applied yet.`,
    ),
    rows: preview.rows,
    problems: preview.errors,
  };
}
