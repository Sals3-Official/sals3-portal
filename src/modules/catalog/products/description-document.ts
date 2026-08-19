import { createHash } from 'crypto';
import { z } from 'zod';

import {
  DESCRIPTION_DOCUMENT_VERSION,
  DISALLOWED_CONTROL,
  INLINE_MARKS,
  MARKUP_OPENER,
  MAX_BLOCKS,
  MAX_RUNS_PER_BLOCK,
  MAX_LABEL_LENGTH,
  MAX_ALT_LENGTH,
  MAX_LIST_ITEMS,
  MAX_TEXT_LENGTH,
  MAX_URL_LENGTH,
  type BulletListBlock,
  type HeadingBlock,
  type ImageBlock,
  type InlineRun,
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
 * string passthrough, and no link block, so there is nothing for a renderer
 * to interpret as markup even before escaping. The one `image` block carries
 * an address the write boundary allow-lists against the Sals3 R2 bucket, not
 * free-form markup. That matters
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

/**
 * One run's text: the same markup and control rules as `plainText`, without
 * the trim or the non-empty floor at the edges of the string.
 *
 * A run legitimately holds interior whitespace — the space between a bold word
 * and the next word has to belong to some run — and trimming each run
 * individually would delete it, breaking the join invariant below on the very
 * documents the feature exists for. Whitespace-only is therefore allowed;
 * genuinely empty is not, because the normaliser drops empty runs and one
 * arriving here means the client skipped it.
 */
const runText = z
  .string()
  .min(1)
  .max(MAX_TEXT_LENGTH)
  .refine((value) => !MARKUP_OPENER.test(value), {
    message: 'Markup is not allowed in product description content.',
  })
  .refine((value) => !DISALLOWED_CONTROL.test(value), {
    message:
      'Control characters are not allowed in product description content.',
  });

const inlineRunSchema = z.object({
  text: runText,
  /**
   * A closed enum, so an unknown mark is a rejected save rather than a style
   * a renderer has to decide what to do with. `.max` matches the vocabulary
   * size: the same mark twice is not a different meaning, and the normaliser
   * never emits it.
   */
  marks: z.array(z.enum(INLINE_MARKS)).max(INLINE_MARKS.length).optional(),
}) satisfies z.ZodType<InlineRun>;

const paragraphBlockSchema = z.object({
  type: z.literal('paragraph'),
  text: plainText(MAX_TEXT_LENGTH),
  runs: z.array(inlineRunSchema).max(MAX_RUNS_PER_BLOCK).optional(),
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

/**
 * A description image.
 *
 * `url` is shape-checked here and **allow-listed separately at the write
 * boundary** (`assertDescriptionImagesAreStored`), not in this schema. This
 * schema is also the read path: folding an environment-dependent host check
 * into it would mean a renamed `CLOUDFLARE_R2_PUBLIC_BASE_URL` silently
 * emptying every description that holds an image, in the editor and on the
 * storefront at once. Refusing a bad address on the way in is the same
 * protection without that failure mode.
 */
const imageBlockSchema = z.object({
  type: z.literal('image'),
  url: z.string().url().max(MAX_URL_LENGTH),
  alt: plainText(MAX_ALT_LENGTH),
  caption: plainText(MAX_TEXT_LENGTH).optional(),
}) satisfies z.ZodType<ImageBlock>;

export const descriptionBlockSchema = z.discriminatedUnion('type', [
  paragraphBlockSchema,
  headingBlockSchema,
  bulletListBlockSchema,
  keyValueListBlockSchema,
  imageBlockSchema,
]);

export { DESCRIPTION_DOCUMENT_VERSION };

/**
 * A paragraph's `runs` must join to exactly its `text`.
 *
 * Enforced here, at the document level, rather than on the block schema:
 * `z.discriminatedUnion` takes plain object schemas, and a `superRefine`
 * wrapper around the paragraph member would have to be unwrapped for the
 * discriminator to stay resolvable. One walk over the blocks is also the only
 * place this rule lives, which is what the block union's own `satisfies`
 * checks buy elsewhere.
 *
 * The rule itself is the reason emphasis is safe to add at all. Two fields
 * that could describe different sentences would mean a buyer's view depended
 * on whether their renderer understood marks — a seller could review the
 * styled paragraph, publish, and have different words reach every consumer
 * that reads `text`, which today is the storefront, the meta-description
 * suggestion, and the readiness check. One canonical string, optionally
 * described a second time, cannot diverge from itself.
 *
 * Marks are not deduplicated or reordered on the way in. Both are the client
 * normaliser's job, and quietly rewriting the payload here would mean the
 * checksum stored as the revision's identity describes a document the editor
 * never showed the seller.
 */
export const descriptionDocumentSchema = z
  .object({
    version: z.literal(DESCRIPTION_DOCUMENT_VERSION),
    blocks: z.array(descriptionBlockSchema).max(MAX_BLOCKS),
  })
  .superRefine((document, context) => {
    document.blocks.forEach((block, index) => {
      if (block.type !== 'paragraph') return;

      const { runs } = block;

      if (runs === undefined) return;

      const path = ['blocks', index, 'runs'];

      if (runs.length === 0) {
        context.addIssue({
          code: 'custom',
          path,
          message:
            'Omit `runs` for an unemphasised paragraph rather than sending an empty list.',
        });

        return;
      }

      if (runs.map((run) => run.text).join('') !== block.text) {
        context.addIssue({
          code: 'custom',
          path,
          message:
            'Description emphasis does not match the paragraph text it describes.',
        });
      }

      runs.forEach((run, runIndex) => {
        const marks = run.marks ?? [];

        if (new Set(marks).size !== marks.length) {
          context.addIssue({
            code: 'custom',
            path: [...path, runIndex, 'marks'],
            message: 'A run repeats a mark.',
          });
        }
      });
    });
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
