/**
 * The publication gates, as one catalogue of seller-facing copy.
 *
 * The problem this solves: `publish.ts` refuses a listing for eleven distinct
 * reasons, and until now the editor's readiness panel knew about three of them.
 * The other eight were reachable only by pressing Publish and reading the
 * failure — and one of them, the Sals3 category, the panel actively contradicted
 * by calling it a warning and saying publication was allowed.
 *
 * A readiness panel exists to answer "can this publish, and if not, why". A panel
 * that can only answer it for three of eleven gates is not doing that job.
 *
 * ## What is shared, and what deliberately is not
 *
 * Shared: the reason vocabulary, the seller-facing wording, and which editor
 * section each gate belongs to. All of it lives here, and `PublishRefusal` is
 * derived from these keys, so a gate added to `publish.ts` without copy here is
 * a compile error rather than a silent eleventh case.
 *
 * **Not** shared: the evaluation. `publish.ts` decides inside a transaction with
 * the pricing resolver, the market capability boundary, and per-variant offer and
 * media rows in hand. The editor has a projection of a product. Pretending one
 * function could answer both would mean either weakening the server's checks to
 * what a client can see, or claiming on the client a certainty only the server
 * has. So the server keeps its logic untouched, and the editor predicts what it
 * can from data it genuinely holds.
 *
 * ## The direction that matters
 *
 * Under-warning is safe: the seller presses Publish and gets the refusal they
 * would have got anyway. Over-warning is not: a blocker the server would never
 * raise stops a listing that could have gone live, and no amount of correct copy
 * makes that acceptable. So a gate is predicted here only where the editor's own
 * data settles it, and the ones it cannot settle are named below rather than
 * guessed at.
 */

/** Where in the editor a seller goes to clear a gate. */
export type PublishGateSection =
  | 'basic'
  | 'specification'
  | 'description'
  | 'variants'
  | 'markets'
  | 'specs'
  | 'review';

export type PublishGate = {
  title: string;
  explanation: string;
  resolution: string;
  section: PublishGateSection;
  /**
   * Whether the editor can decide this gate from a product projection.
   *
   * `false` means the copy is here for the refusal message, but no readiness
   * blocker is derived — because the editor would have to guess. Each one says
   * what it is missing.
   */
  predictableInEditor: boolean;
};

export const PUBLISH_GATES = {
  NO_ACTIVE_VARIANT: {
    title: 'No variant is listed',
    explanation:
      'Every listing needs at least one variant switched on in Variants & Pricing. A product with none has nothing for a buyer to add to a cart.',
    resolution: 'Switch on at least one variant.',
    section: 'variants',
    predictableInEditor: true,
  },
  SALS3_CATEGORY_REQUIRED: {
    title: 'Sals3 category is required',
    explanation:
      "This product sits under the supplier's own category, which is a starting point rather than a Sals3 one. Choose a Sals3 category in Basic Information — it is what buyers browse and what the price rules read.",
    resolution: 'Choose a Sals3 category.',
    section: 'basic',
    predictableInEditor: true,
  },
  OPTIONS_UNMAPPED: {
    title: 'Variant Matrix needs its option names',
    explanation:
      "The supplier's labels split into more than one buyer option, so each one needs a name before buyers see them. Supplier values stay as received either way.",
    resolution: 'Name each option in the Variant Matrix.',
    section: 'variants',
    predictableInEditor: true,
  },
  NO_ACTIVE_SUPPLIER_BINDING: {
    title: 'No variant is linked to the supplier',
    explanation:
      'Fulfilment matches each Sals3 variant to the supplier’s own variant. Without that link an order could be taken with no way to place it.',
    resolution: 'Re-import this product from Product Sourcing.',
    section: 'variants',
    predictableInEditor: true,
  },
  NO_SUPPLIER_COST: {
    title: 'No supplier cost on any listable variant',
    explanation:
      'Price rules work from the supplier’s cost. With none recorded, no selling price can be resolved and the listing would have nothing to charge.',
    resolution: 'Capture supplier evidence from Product Sourcing.',
    section: 'variants',
    predictableInEditor: true,
  },
  NO_APPROVED_MEDIA: {
    title: 'No approved photo is on file',
    explanation:
      'A listing publishes with at least one photo Sals3 may show — either your own upload or the supplier’s original where its terms allow it.',
    resolution: 'Upload a photo, or allow the supplier’s.',
    section: 'basic',
    predictableInEditor: true,
  },
  RETAIL_BELOW_SUPPLIER_COST: {
    title: 'Retail price must include at least 2.5% markup',
    explanation:
      'This variant does not clear the required 2.5% supplier-cost floor, so the seller would publish a zero-spread or thin-spread offer.',
    resolution: 'Raise the retail price to at least 2.5% above supplier cost.',
    section: 'variants',
    predictableInEditor: true,
  },
  /**
   * Not predicted. The resolver reads the seller's category pricing policy and
   * the market capability boundary, neither of which the editor projection
   * carries — and a wrong guess here reads as "your pricing is broken" on a
   * listing whose pricing is fine.
   */
  PRICING_UNRESOLVED: {
    title: 'Selling price is not resolved',
    explanation:
      'The price rules could not produce a selling price for this product yet.',
    resolution: 'Check the category pricing policy in Market rules.',
    section: 'variants',
    predictableInEditor: false,
  },
  /**
   * Not predicted. Belongs to the seller's market profile rather than the
   * product, and the editor is handed eligibility evidence per market rather
   * than the profile's own lifecycle state.
   */
  NO_ACTIVE_MARKET_PROFILE: {
    title: 'No active market profile',
    explanation:
      'This account has no active market configuration, so there is no destination to publish into.',
    resolution: 'Set up a market in Market rules.',
    section: 'markets',
    predictableInEditor: false,
  },
  /** Not predicted, for the same reason as the market profile. */
  CURRENCY_NOT_AUTHORIZED: {
    title: 'Selling currency is not authorised',
    explanation:
      'The market profile does not authorise the currency this listing would sell in.',
    resolution: 'Check the selling currency in Market rules.',
    section: 'markets',
    predictableInEditor: false,
  },
  /**
   * Not predicted. A product reaching the editor has an open draft by
   * definition, so a blocker here would only ever be wrong.
   */
  NO_PUBLISHABLE_REVISION: {
    title: 'No revision is ready to publish',
    explanation: 'There is no draft or approved revision to publish.',
    resolution: 'Save the draft first.',
    section: 'review',
    predictableInEditor: false,
  },
  /**
   * Not predictable by anyone in advance: it depends on whether another product
   * takes the slug between rendering the page and pressing Publish.
   */
  SLUG_UNAVAILABLE: {
    title: 'The product web address is taken',
    explanation:
      'Another listing already uses the address this product name produces.',
    resolution: 'Change the product name slightly.',
    section: 'basic',
    predictableInEditor: false,
  },
} as const satisfies Record<string, PublishGate>;

/**
 * The refusal vocabulary, derived from the catalogue.
 *
 * `publish.ts` imports this as its own refusal type, so a gate it learns to
 * refuse without copy here does not compile. That is the whole mechanism keeping
 * the panel and the server from drifting apart again — a type error rather than a
 * convention somebody has to remember.
 */
export type PublishGateReason = keyof typeof PUBLISH_GATES;

export function publishGate(reason: PublishGateReason): PublishGate {
  return PUBLISH_GATES[reason];
}

/** The gates the editor may raise as readiness blockers. */
export const EDITOR_PREDICTABLE_GATES = (
  Object.keys(PUBLISH_GATES) as PublishGateReason[]
).filter((reason) => PUBLISH_GATES[reason].predictableInEditor);
