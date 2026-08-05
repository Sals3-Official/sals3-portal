import type { ActionResult } from '@/lib/portal/action-result';
import type { CsvPreviewRow } from './csv';

/**
 * State shape for the CSV import form.
 *
 * This lives outside the `'use server'` action module on purpose: a server
 * action file may only export async functions, so a constant exported from
 * there reaches the client as `undefined`.
 */
export type ImportPreviewState = ActionResult & {
  rows: CsvPreviewRow[];
  problems: string[];
};

export const IDLE_IMPORT: ImportPreviewState = {
  status: 'idle',
  message: '',
  fieldErrors: {},
  rows: [],
  problems: [],
};
