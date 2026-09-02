import type { DescriptionBlock } from './description-document';

/**
 * Check description COPY before it is stored, not after it is live.
 *
 * `descriptionDocumentSchema` checks the document's shape; this checks what
 * the words do. Moved server-side from the automation client on the owner's
 * 2026-09-02 instruction (functions belong in the API), and enforced on the
 * internal API only - the Description Studio keeps a person in the loop, and
 * a person overruling a style rule on their own page is an editing decision,
 * not a defect. An unattended API caller has no such person, so for it every
 * one of these is a refusal.
 *
 * Each rule earned its place on a live page:
 *
 * - **Lead paragraph.** The storefront's `answerSummary()` renders block 0
 *   under the product title and requires a paragraph exactly; 49 rewritten
 *   descriptions opened with a heading, and the text under the product name
 *   simply vanished. The owner found it, not a test.
 * - **Borrowed voice.** "CJ lists denim with cotton as the main fabric
 *   composition" was live for a week. The fact is never the problem; the
 *   citation is - a buyer learns we quote a wholesaler they have never heard
 *   of, and a search engine credits the fact to CJ.
 * - **Logistics.** Rule 6, owner decision 2026-08-26: shipping/returns copy
 *   is identical on every listing and spends the characters that should
 *   describe the product.
 * - **Size claims.** A description said "sizes M through 4XL" on a picker
 *   selling XS-3XL (2026-09-02). Copy was written before the variant list
 *   was read and nothing compared the two. A size range in prose is a
 *   factual claim about the picker, so the picker checks it.
 *
 * What this never does: write or rewrite anything. A rule that silently
 * edited prose would be worse than one that refused - the point of a refusal
 * is that someone reads it and decides.
 */

const BORROWED_VOICE = [
  'cj lists',
  'cj states',
  'cj says',
  'cj describes',
  'cj reports',
  'the supplier lists',
  'the supplier states',
  'the supplier says',
  'supplier lists',
  'supplier states',
  'according to the supplier',
  'as listed by',
  'the manufacturer states',
  'per the supplier',
] as const;

const LOGISTICS_WORDS = [
  'shipping',
  'shipped',
  'dispatch',
  'delivery',
  'tracked',
  'returns',
  'refund',
  'warranty',
  'customer support',
  'money back',
] as const;

/**
 * Size tokens prose can claim, word-bounded and case-sensitive.
 *
 * Longer alternatives first - the engine takes the first branch that matches
 * at a position, so `XL` before `2XL` would split `2XL` in half. Case matters
 * because sizes in prose are capitalised and a lowercase mid-sentence "m"
 * almost never is one. (The first version of this pattern, in the client,
 * was corrupted invisibly by a shell heredoc - `\b` became a literal
 * BACKSPACE - and matched nothing while its smoke test stayed green. It
 * lives in a real source file now for exactly that reason.)
 */
const SIZE_TOKEN = /\b(?:[2-9]XL|XXXL|XXL|XS|XL|S|M|L)\b/g;

/** XXL and 2XL are one size in two spellings; XXXL and 3XL likewise. */
export function canonSize(token: string): string {
  const upper = token.trim().toUpperCase();
  const letters = new Set(upper.split(''));

  if (
    upper.startsWith('X') &&
    upper.endsWith('L') &&
    [...letters].every((letter) => letter === 'X' || letter === 'L')
  ) {
    const xs = upper.split('').filter((letter) => letter === 'X').length;

    return xs > 1 ? `${xs}XL` : 'XL';
  }

  return upper;
}

/** `S`, `2XL`, `32` - a size token rather than a colour. */
export function looksLikeASize(value: string): boolean {
  const token = value.trim().toUpperCase();

  if (token === '') return false;

  if (/^\d+$/.test(token)) {
    const waist = Number(token);

    return waist >= 20 && waist <= 60;
  }

  return (
    ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'].includes(token) ||
    (/^\d+XL$/.test(token) && token.length >= 3) ||
    (token.startsWith('X') && token.endsWith('L'))
  );
}

/**
 * The sizes a product's picker sells, read off its variant labels.
 *
 * Labels arrive in two spellings - mapped (`Colour: Blue, Size: 2XL`) and
 * raw supplier tokens (`Blue-2XL`) - and this reads both, keeping whichever
 * segments look like sizes. Split raw labels on EVERY dash but test whole
 * segments, so `A-2XL` yields `2XL` while `Army Green` yields nothing.
 */
export function sizesOnSale(
  optionLabels: readonly (string | null | undefined)[],
): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];

  optionLabels.forEach((label) => {
    if (label === null || label === undefined) return;

    const segments = label.includes(':')
      ? label.split(',').map((pair) => pair.split(':').slice(1).join(':'))
      : label.split('-');

    segments
      .map((segment) => segment.trim())
      .filter((segment) => looksLikeASize(segment))
      .forEach((segment) => {
        const canon = canonSize(segment);

        if (!seen.has(canon)) {
          seen.add(canon);
          kept.push(segment);
        }
      });
  });

  return kept;
}

function textOf(block: DescriptionBlock): string {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
      return block.text;
    case 'bulletList':
      return block.items.join(' ');
    case 'keyValueList':
      return block.entries
        .map((entry) => `${entry.label} ${entry.value}`)
        .join(' ');
    default:
      // Tables and images carry data, not prose; a chart legitimately names
      // sizes and measurements the copy rules must not read as claims.
      return '';
  }
}

/**
 * Size tokens the copy claims that the picker does not sell.
 *
 * Only claims-not-sold are flagged. The reverse - a sold size the prose does
 * not mention - is normal writing, not an error. And when the caller knows
 * no sizes at all (empty picker, one-size product), nothing is checked:
 * absence of a picker is not evidence against the prose.
 */
export function sizeClaimsNotOnSale(
  blocks: readonly DescriptionBlock[],
  selling: readonly string[],
): string[] {
  const sold = new Set(
    selling.filter((size) => size.trim() !== '').map((size) => canonSize(size)),
  );

  if (sold.size === 0) return [];

  const joined = blocks.map((block) => textOf(block)).join(' ');
  const claimed = new Set(
    [...joined.matchAll(SIZE_TOKEN)].map((match) => canonSize(match[0])),
  );

  return [...claimed]
    .filter((token) => !sold.has(token))
    .sort()
    .map(
      (token) =>
        `the copy claims size ${token} but the picker does not sell it`,
    );
}

export type CopyVerdict = {
  /** Reasons this document must not be stored. Empty means writable. */
  problems: string[];
  /** Advisory only - answer-engine shape. Returned, never blocking. */
  warnings: string[];
};

export default function checkDescriptionCopy(
  blocks: readonly DescriptionBlock[],
  selling: readonly string[],
): CopyVerdict {
  const problems: string[] = [];
  const warnings: string[] = [];

  if (blocks.length === 0) {
    return {
      problems: [
        'the document is empty - clearing a live description is not an edit',
      ],
      warnings: [],
    };
  }

  const [first] = blocks;

  if (first.type !== 'paragraph') {
    problems.push(
      `the first block is a '${first.type}', not a paragraph - the ` +
        `storefront renders block 0 under the product title and shows ` +
        `nothing when it is not a paragraph`,
    );
  } else if (first.text.trim() === '') {
    problems.push('the first block is an empty paragraph');
  }

  const joined = blocks
    .map((block) => textOf(block))
    .join(' ')
    .toLowerCase()
    .split(/\s+/u)
    .join(' ');

  const cited = BORROWED_VOICE.filter((phrase) => joined.includes(phrase));

  if (cited.length > 0) {
    problems.push(
      `cites the supplier (${cited.join(', ')}) - state the fact instead, ` +
        `or a search engine credits it to CJ`,
    );
  }

  const logistics = LOGISTICS_WORDS.filter((word) => joined.includes(word));

  if (logistics.length > 0) {
    problems.push(
      `mentions logistics (${logistics.join(', ')}) - 'About this product' ` +
        `sells the item; shipping and returns are identical on every listing`,
    );
  }

  problems.push(...sizeClaimsNotOnSale(blocks, selling));

  // Answer-engine shape - advisory. A heading like `Details` answers no
  // question a buyer asks; an opening shorter than a sentence gives an
  // answer engine nothing to lift. Style, not correctness, so it never
  // blocks - but it is reported, because silent advice is no advice.
  const headings = blocks.filter((block) => block.type === 'heading');

  if (headings.length === 0) {
    warnings.push('no headings - nothing here can be quoted as an answer');
  }

  headings
    .filter((block) =>
      [
        'details',
        'description',
        'information',
        'product details',
        'more',
      ].includes(block.text.trim().toLowerCase()),
    )
    .forEach((block) => {
      warnings.push(
        `the heading '${block.text}' answers no question a buyer asks`,
      );
    });

  if (
    first.type === 'paragraph' &&
    first.text.trim() !== '' &&
    first.text.trim().split(/\s+/u).length < 8
  ) {
    warnings.push('the opening paragraph is too short to answer anything');
  }

  return { problems, warnings };
}
