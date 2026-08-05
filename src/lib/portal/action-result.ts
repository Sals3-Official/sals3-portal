import { z } from 'zod';
import { PermissionError } from '@/lib/auth/permissions';

/**
 * One result shape for every server action, so each form can report success or
 * a field-level error without a special case. Messages are written for the
 * person using the screen: short, plain, and free of internal detail.
 */
export type ActionResult = {
  status: 'idle' | 'success' | 'error';
  message: string;
  fieldErrors: Record<string, string[]>;
};

export const IDLE_RESULT: ActionResult = {
  status: 'idle',
  message: '',
  fieldErrors: {},
};

export function success(message: string): ActionResult {
  return { status: 'success', message, fieldErrors: {} };
}

export function failure(
  message: string,
  fieldErrors: Record<string, string[]> = {},
): ActionResult {
  return { status: 'error', message, fieldErrors };
}

/** Turns a Zod failure into field errors the form can show next to inputs. */
export function fromZodError(error: z.ZodError): ActionResult {
  const flattened = z.flattenError(error);

  return failure('Check the highlighted fields and try again.', {
    ...flattened.fieldErrors,
  });
}

/**
 * Maps a thrown error to a safe user message. A permission failure says so; any
 * other error becomes a generic message, and the detail stays in the server log
 * instead of the response.
 */
export function fromThrown(error: unknown, context: string): ActionResult {
  if (error instanceof PermissionError) {
    return failure(error.message);
  }

  // Structured server-side log. The detail stays here on purpose - rule 34
  // forbids returning stack traces or internal detail to the client.
  // eslint-disable-next-line no-console
  console.error(`[portal] ${context} failed`, error);

  return failure('Something went wrong. Try again.');
}
