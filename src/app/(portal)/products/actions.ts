'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  failure,
  fromThrown,
  fromZodError,
  success,
  type ActionResult,
} from '@/lib/portal/action-result';
import { bulkProductActionSchema } from '@/lib/products/schemas';
import { STATUS_TRANSITIONS } from '@/lib/products/status-workflow';
import {
  applyTransition,
  bulkTransition,
  deleteProducts,
  duplicateProduct,
} from '@/services/products';

/**
 * Product server actions.
 *
 * Every action re-parses its input with a Zod schema and relies on the service
 * layer for the permission and ownership checks. Nothing here trusts the form:
 * the client sends strings, and only allow-listed values survive parsing.
 */

const BULK_MESSAGES = {
  publish: 'published',
  unpublish: 'unpublished',
  archive: 'archived',
  delete: 'deleted',
} as const;

export async function bulkProductAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = bulkProductActionSchema.safeParse({
    productIds: formData.getAll('productIds').map(String),
    action: formData.get('action'),
  });

  if (!parsed.success) {
    return fromZodError(parsed.error);
  }

  const { productIds, action } = parsed.data;

  try {
    const changed =
      action === 'delete'
        ? await deleteProducts(productIds)
        : await bulkTransition(productIds, action);

    revalidatePath('/products');

    if (changed === 0) {
      return failure(
        'No product changed. The selected products cannot move to that state.',
      );
    }

    const noun = changed === 1 ? 'product' : 'products';

    return success(`${changed} ${noun} ${BULK_MESSAGES[action]}.`);
  } catch (error) {
    return fromThrown(error, `bulk ${action}`);
  }
}

export async function duplicateProductAction(
  productId: string,
): Promise<ActionResult> {
  const id = z.string().trim().min(1).max(64).safeParse(productId);

  if (!id.success) {
    return failure('That product was not found.');
  }

  try {
    const copy = await duplicateProduct(id.data);

    if (copy === null) {
      return failure('That product was not found.');
    }

    revalidatePath('/products');

    return success(`Copied to a new draft: ${copy.name}.`);
  } catch (error) {
    return fromThrown(error, 'duplicate product');
  }
}

export async function transitionProductAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get('productId') ?? '');
  const raw = String(formData.get('transition') ?? '');
  const transition = STATUS_TRANSITIONS.find((value) => value === raw);
  const reasonValue = formData.get('reason');
  const reason = reasonValue === null ? null : String(reasonValue).trim();

  if (id === '' || transition === undefined) {
    return failure('That action is not available.');
  }

  if (transition === 'reject' && (reason === null || reason.length < 10)) {
    return failure('Write the reason for the rejection.', {
      reason: [
        'Write at least 10 characters so the seller can fix the product.',
      ],
    });
  }

  try {
    const updated = await applyTransition(id, transition, reason);

    if (updated === null) {
      return failure('That action is not available for this product now.');
    }

    revalidatePath('/products');
    revalidatePath(`/products/${id}`);

    return success('The product status changed.');
  } catch (error) {
    return fromThrown(error, `transition ${raw}`);
  }
}
