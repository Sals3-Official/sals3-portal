'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  failure,
  fromThrown,
  fromZodError,
  type ActionResult,
} from '@/lib/portal/action-result';
import {
  productFormSchema,
  readProductForm,
  toProductInput,
} from '@/lib/products/form-schema';
import { productInputSchema } from '@/lib/products/schemas';
import { createProduct, updateProduct } from '@/services/products';

/**
 * Create and edit actions.
 *
 * Both parse the raw form, then re-check the mapped result against
 * `productInputSchema`. Two passes are deliberate: the first turns strings into
 * values and reports errors against form field names, the second enforces the
 * cross-field rules (a sale price below the regular price, a discount window in
 * the right order) that the store depends on.
 */

function parse(formData: FormData) {
  const form = productFormSchema.safeParse(readProductForm(formData));

  if (!form.success) {
    return { ok: false as const, result: fromZodError(form.error) };
  }

  const input = productInputSchema.safeParse(toProductInput(form.data));

  if (!input.success) {
    return { ok: false as const, result: fromZodError(input.error) };
  }

  return { ok: true as const, input: input.data };
}

export async function createProductAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = parse(formData);

  if (!parsed.ok) {
    return parsed.result;
  }

  let productId: string;

  try {
    const created = await createProduct(parsed.input);

    productId = created.id;
  } catch (error) {
    return fromThrown(error, 'create product');
  }

  revalidatePath('/products');

  return redirect(`/products/${productId}?created=1`);
}

export async function updateProductAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const productId = String(formData.get('productId') ?? '');

  if (productId === '') {
    return failure('That product was not found.');
  }

  const parsed = parse(formData);

  if (!parsed.ok) {
    return parsed.result;
  }

  try {
    const updated = await updateProduct(productId, parsed.input);

    if (updated === null) {
      return failure('That product was not found.');
    }
  } catch (error) {
    return fromThrown(error, 'update product');
  }

  revalidatePath('/products');
  revalidatePath(`/products/${productId}`);

  return redirect(`/products/${productId}?saved=1`);
}
