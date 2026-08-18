import { createHash } from 'crypto';
import { z } from 'zod';

import {
  DESCRIPTION_DOCUMENT_VERSION,
  DISALLOWED_CONTROL,
  MARKUP_OPENER,
  MAX_BLOCKS,
  MAX_LABEL_LENGTH,
  MAX_LIST_ITEMS,
  MAX_TEXT_LENGTH,
  type BulletListBlock,
  type HeadingBlock,
  type KeyValueListBlock,
  type ParagraphBlock,
} from '@/lib/products/description-blocks';

/**
 * The structured, allow-listed description format
 * (`cj-candidate-to-sals3-product-draft-implementation-spec.md` §5.1:
 * *"`descriptionDocument` uses a structured allow-listed document format.
 * Rendering must not accept unsanitized supplier HTML."*).
 *
 * It is an allow list, not a sanitiser. There is no `html` block, no raw
 * string passthrough, and no link/image block, so there is nothing for a
 * renderer to interpret as markup even before escaping. That matters
 * specifically because CJ's `description` **is** supplier HTML: it is fetched
 * and stored as evidence today but has no sanitiser (spec §26, and the
 * parked-with-unblock-condition entry that says sanitisation must be designed
 * *together with* this format rather than bolted on). Until that work
 * happens, a CJ-sourced draft starts from `emptyDescriptionDocument()` — an
 * honestly empty document the seller fills in, never a copy of unsafe markup.
 *
 * The text rules below reject markup-shaped input rather than escaping it, so
 * a malformed document fails at the server boundary instead of becoming a
 * stored-XSS payload waiting for one careless `dangerouslySetInnerHTML`.
 * `a < b` still passes: the pattern requires a character that could begin a
 * tag, comment, or processing instruction immediately after the `<`.
 */

/**
 * The limits, the markup/control rules, and the block shapes themselves come
 * from `@/lib/products/description-blocks`, which the seller-facing editor
 * imports too — this module cannot be imported from a client component
 * because of `node:crypto`. Each schema below is `satisfies
 * z.ZodType<...>`-checked against the shared type, so an editor that learns
 * to build a block this schema would refuse fails to compile.
 */
const plainText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !MARKUP_OPENER.test(value), {
      message: 'Markup is not allowed in product description content.',
    })
    .refine((value) => !DISALLOWED_CONTROL.test(value), {
      message:
        'Control characters are not allowed in product description content.',
    });

const paragraphBlockSchema = z.object({
  type: z.literal('paragraph'),
  text: plainText(MAX_TEXT_LENGTH),
}) satisfies z.ZodType<ParagraphBlock>;

const headingBlockSchema = z.object({
  type: z.literal('heading'),
  /** Only sub-headings: the product title owns the single `h1` on the page. */
  level: z.union([z.literal(2), z.literal(3)]),
  text: plainText(MAX_LABEL_LENGTH),
}) satisfies z.ZodType<HeadingBlock>;

const bulletListBlockSchema = z.object({
  type: z.literal('bulletList'),
  items: z.array(plainText(MAX_TEXT_LENGTH)).min(1).max(MAX_LIST_ITEMS),
}) satisfies z.ZodType<BulletListBlock>;

/** Materials, care instructions, and similar spec-style content (spec §9.4). */
const keyValueListBlockSchema = z.object({
  type: z.literal('keyValueList'),
  entries: z
    .array(
      z.object({
        label: plainText(MAX_LABEL_LENGTH),
        value: plainText(MAX_TEXT_LENGTH),
      }),
    )
    .min(1)
    .max(MAX_LIST_ITEMS),
}) satisfies z.ZodType<KeyValueListBlock>;

export const descriptionBlockSchema = z.discriminatedUnion('type', [
  paragraphBlockSchema,
  headingBlockSchema,
  bulletListBlockSchema,
  keyValueListBlockSchema,
]);

export { DESCRIPTION_DOCUMENT_VERSION };

export const descriptionDocumentSchema = z.object({
  version: z.literal(DESCRIPTION_DOCUMENT_VERSION),
  blocks: z.array(descriptionBlockSchema).max(MAX_BLOCKS),
});

export type DescriptionBlock = z.infer<typeof descriptionBlockSchema>;
export type DescriptionDocument = z.infer<typeof descriptionDocumentSchema>;

export function emptyDescriptionDocument(): DescriptionDocument {
  return { version: DESCRIPTION_DOCUMENT_VERSION, blocks: [] };
}

/**
 * Deterministic serialization with sorted keys.
 *
 * `JSON.stringify` preserves insertion order, so two documents that differ
 * only in key order would checksum differently and look like a real edit in
 * the audit trail. Sorting removes that false signal, which is what makes the
 * checksum usable as the revision's identity in
 * `product_revisions.content_checksum`.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);

  if (typeof value === 'object' && value !== null) {
    const entries = value as Record<string, unknown>;

    return Object.fromEntries(
      Object.keys(entries)
        .sort()
        .map((key) => [key, canonicalize(entries[key])]),
    );
  }

  return value;
}

export function checksumOfDescriptionDocument(
  document: DescriptionDocument,
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(document)))
    .digest('hex');
}
