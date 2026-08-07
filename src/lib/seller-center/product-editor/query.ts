import { z } from 'zod';
import type { EditorLifecycle } from './types';

/**
 * Development-only entry points into the editor's save/validation states.
 *
 * These states are real UI - save failed, validation failed, connection
 * unavailable, session expired - but nothing in a fixture-backed prototype
 * can *reach* them: there is no save to fail and no connection to drop. The
 * design handoff's answer was a visible control strip above the frame,
 * which is a prototype artefact and has no place in a seller-facing screen.
 *
 * A query parameter is the honest alternative. It exercises every state,
 * it is shareable in a review, it is testable, and it adds nothing to the
 * UI a seller would ever see. Same posture as `?fixture=`: an allow list,
 * and an unrecognised value falls back to the normal idle state rather
 * than erroring.
 */

const PARAM_TO_LIFECYCLE = {
  saving: 'SAVING',
  saved: 'SAVED',
  'save-failed': 'SAVE_FAILED',
  validating: 'VALIDATING',
  'validation-failed': 'VALIDATION_FAILED',
  'connection-unavailable': 'CONNECTION_UNAVAILABLE',
  'session-expired': 'SESSION_EXPIRED',
} as const satisfies Record<string, EditorLifecycle>;

export type EditorLifecycleParam = keyof typeof PARAM_TO_LIFECYCLE;

export const EDITOR_LIFECYCLE_PARAMS = Object.keys(
  PARAM_TO_LIFECYCLE,
) as EditorLifecycleParam[];

export const editorLifecycleParamSchema = z
  .enum(
    EDITOR_LIFECYCLE_PARAMS as [
      EditorLifecycleParam,
      ...EditorLifecycleParam[],
    ],
  )
  .optional()
  .catch(undefined);

export function lifecycleFromParam(
  param: EditorLifecycleParam | undefined,
): EditorLifecycle {
  return param === undefined ? 'IDLE' : PARAM_TO_LIFECYCLE[param];
}
