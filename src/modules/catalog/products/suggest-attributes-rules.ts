/**
 * The attribute-decision rules, server-side.
 *
 * ## Where this came from
 *
 * These rules lived in the automation client (`api_enrich.py` +
 * `COMMON_SENSE_PANTS_DEFAULTS` in the browser engine) and were moved here on
 * the owner's instruction of 2026-09-02: local scripts may exist, but the
 * codes and functions themselves belong in the API. Every rule below was
 * proven - and several were CORRECTED - against live products first; the
 * corrections travel with the rules as comments, because each one was a real
 * false claim headed for a live page.
 *
 * ## What these rules refuse to decide, permanently
 *
 * Physical claims. `Material` comes from the supplier's own property table
 * or stays blank; nothing here invents a fibre, a measurement, a weight or a
 * certification. And `Pants Type` has NO default: every value is a distinct
 * garment, a wrong one is a false statement rather than a near-miss, and
 * when no signal fires the field is reported as pending so a person decides
 * it off the photograph.
 *
 * ## Inputs are clauses, not one string
 *
 * Signals are matched per CLAUSE (the title, each supplier property value,
 * each caller-known value) with a negation guard. Both halves were paid for:
 * "Is there a belt: No belt" nearly published `Buckle Belted` until the
 * negation guard existed, and then the guard itself suppressed a genuine
 * signal in the NEXT clause until clause boundaries stopped negations
 * crossing them.
 */

export type AttributeField = {
  attributeName: string;
  /** `REQUIRED` / `RECOMMENDED` (any casing; substring-matched). */
  requirement: string;
  allowedValues: readonly string[];
  /** Already-stored values; a filled field is never re-decided. */
  values: readonly string[];
};

export type SupplierProperty = { label: string; value: string };

export type SuggestedAttributes = {
  /** `{name: [value]}`, every value present in the field's own list. */
  decided: Record<string, string[]>;
  /** One audit line per decision - "Name=Value (source)". Rule 1's paper trail. */
  notes: string[];
  /** Required/recommended fields still blank, with their allowed values. */
  pending: { name: string; requirement: string; options: string[] }[];
};

/**
 * One value, two spellings. `attribute-display-defaults.ts` paints the
 * stored token `UNBRANDED` as "Generic", so a rule written against either
 * spelling must match the other - Brand stayed blank on three live products
 * before this alias existed. Each surface still gets the spelling it
 * actually offers: the match returns the option AS THE LIST SPELLS IT.
 */
const VALUE_ALIASES: Record<string, readonly string[]> = {
  generic: ['unbranded'],
  unbranded: ['generic'],
};

/** Policy fields - owner decisions, not inferences. */
const POLICY_DEFAULTS: Record<string, string> = {
  brand: 'Generic',
  condition: 'New',
  // Owner decision 2026-08-26: `Others`, NOT the ships-from country. Writing
  // `China` off the shipping origin contradicted it on three live products.
  'country of origin': 'Others',
  'country/region of manufacture': 'Others',
  'tall fit': 'No',
};

/**
 * Merchandising signals. `default` fires when no signal does; a table with
 * no default leaves the field pending on purpose.
 */
const MERCHANDISING_RULES: Record<string, Record<string, string>> = {
  // NO default - see the module comment.
  'pants type': {
    cargo: 'Cargo Pants',
    'multi-pocket': 'Cargo Pants',
    'multi pocket': 'Cargo Pants',
    tactical: 'Tactical Combat Pants',
    combat: 'Tactical Combat Pants',
    jean: 'Jeans / Denim',
    denim: 'Jeans / Denim',
    jogger: 'Joggers',
    sweatpant: 'Sweatpants',
    'sweat pant': 'Sweatpants',
    chino: 'Chinos',
    legging: 'Leggings',
    'wide leg': 'Wide-Leg Pants',
    'wide-leg': 'Wide-Leg Pants',
    slack: 'Formal Slacks / Trousers',
    'suit trouser': 'Formal Slacks / Trousers',
  },
  'pants fit': {
    cargo: 'Cargo Relaxed',
    jeans: 'Regular / Straight Leg',
    straight: 'Regular / Straight Leg',
    jogger: 'Loose / Baggy',
    sweat: 'Loose / Baggy',
    'wide leg': 'Wide Leg',
    // Both spellings: a photo answer of "Wide-Leg Pants" must cascade here,
    // and `wide leg` (space) does not occur in `wide-leg`.
    'wide-leg': 'Wide Leg',
    loose: 'Loose / Baggy',
    baggy: 'Loose / Baggy',
    skinny: 'Skinny',
    slim: 'Slim Fit',
    tapered: 'Tapered',
    default: 'Regular / Straight Leg',
  },
  'waist height': {
    'high waist': 'High Waist',
    'high-waist': 'High Waist',
    'low waist': 'Low Waist',
    'low-rise': 'Low Waist',
    default: 'Mid Waist',
  },
  'fly type': {
    elastic: 'Full Elastic Waistband',
    waistband: 'Full Elastic Waistband',
    jogger: 'Full Elastic Waistband',
    sweat: 'Full Elastic Waistband',
    drawstring: 'Drawstring Elastic',
    'button fly': 'Button Fly',
    // `belted`/`buckle`, never bare `belt`: "Is there a belt: No belt" is a
    // real supplier property, and bare `belt` matched inside it.
    belted: 'Buckle Belted',
    buckle: 'Buckle Belted',
    default: 'Zipper Fly & Button',
  },
  season: {
    // "plus velvet thickening" is the supplier's phrase for a fleece lining,
    // and it is the whole reason a garment is winterwear.
    'velvet thickening': 'Winter',
    fleece: 'Winter',
    thickening: 'Winter',
    winter: 'Winter',
    summer: 'Summer',
    breathable: 'Summer',
    'ice silk': 'Summer',
    default: 'All Seasons',
  },
  style: {
    tactical: 'Tactical',
    street: 'Street Style',
    vintage: 'Vintage',
    retro: 'Vintage',
    formal: 'Formal / Office',
    // NOT bare `sport`: suppliers open titles with "Sports All-match" as
    // filler on garments their own next word calls casual.
    sportswear: 'Athletic',
    athletic: 'Athletic',
    default: 'Casual',
  },
  occasion: {
    'work clothes': 'Work / Office',
    workwear: 'Work / Office',
    overall: 'Work / Office',
    tactical: 'Outdoor / Tactical',
    sport: 'Sports',
    formal: 'Work / Office',
    default: 'Everyday Casual',
  },
  pattern: {
    camouflage: 'Camouflage',
    camo: 'Camouflage',
    ripped: 'Distressed / Ripped',
    distressed: 'Distressed / Ripped',
    stripe: 'Striped',
    plaid: 'Plaid / Checkered',
    check: 'Plaid / Checkered',
    print: 'Print',
    default: 'Plain / Solid',
  },
};

/** Supplier property labels that state fibre content, most specific first. */
const MATERIAL_LABELS = [
  'material composition',
  'main fabric composition',
  'material',
  'fabric',
];

/** Fibre words mapped onto the category's own Material options. */
const MATERIAL_SIGNALS: readonly (readonly [string, string])[] = [
  ['denim', 'Denim'],
  ['cotton', 'Cotton'],
  ['linen', 'Linen'],
  ['polyester', 'Polyester'],
  ['corduroy', 'Corduroy'],
  ['fleece', 'Fleece'],
  ['nylon', 'Ripstop Nylon'],
  ['spandex', 'Spandex / Stretch'],
  ['twill', 'Twill'],
];

/**
 * Words that flip a signal's meaning when they sit just before it, within
 * one clause. Window of 14 characters: enough for "is there a belt: no
 * belt", short enough that an unrelated "no" earlier in a sentence does not
 * suppress a genuine signal.
 */
const NEGATORS = ['no ', 'not ', 'non-', 'non ', 'without ', 'never '];
const NEGATION_WINDOW = 14;

/** The size tokens that make a range "extended" - the Portal's own rule. */
const EXTENDED_SIZE = /\b(?:[2-6]X+L|XX+L)\b/i;

export function matchOption(
  options: readonly string[],
  wanted: string,
): string | null {
  const wantedKey = wanted.trim().toLowerCase();
  const accepted = new Set([wantedKey, ...(VALUE_ALIASES[wantedKey] ?? [])]);

  return (
    options.find((option) => accepted.has(option.trim().toLowerCase())) ?? null
  );
}

/**
 * Is `signal` present in any clause, other than under a negation? Every
 * occurrence within a clause is checked - "no belt, buckle belted optional"
 * still matches on the second - and a clause boundary stops a negation
 * reaching the next clause's genuine signal.
 */
export function signalMatches(
  clauses: readonly string[],
  signal: string,
): boolean {
  return clauses.some((clause) => {
    let from = 0;

    for (;;) {
      const at = clause.indexOf(signal, from);

      if (at === -1) return false;

      const window = clause.slice(Math.max(0, at - NEGATION_WINDOW), at);

      if (!NEGATORS.some((negator) => window.includes(negator))) return true;

      from = at + 1;
    }
  });
}

export function derivePlusSize(
  variantLabels: readonly string[],
): string | null {
  const joined = variantLabels.join(' ');

  if (joined.trim() === '') return null;

  return EXTENDED_SIZE.test(joined) ? 'Yes' : 'No';
}

/**
 * The Material option the supplier's own properties support, or null.
 *
 * A physical claim: read or blank, never defaulted. The one liberty is
 * naming a blend by its dominant fibre (what the field asks for), and the
 * one exception is jeans - the supplier writes "Material: Cotton" on jeans,
 * denim IS cotton, but `Denim` is the truer option where both exist.
 */
export function materialFromProperties(
  properties: readonly SupplierProperty[],
  options: readonly string[],
  title: string,
): string | null {
  const lowered = properties.map((property) => ({
    label: property.label.toLowerCase(),
    value: property.value.toLowerCase(),
  }));

  const stated = MATERIAL_LABELS.map(
    (wanted) => lowered.find((entry) => entry.label.includes(wanted))?.value,
  ).find((value) => value !== undefined && value !== '');

  if (stated === undefined) return null;

  const titled = title.toLowerCase();

  if (
    (titled.includes('jean') || titled.includes('denim')) &&
    stated.includes('cotton')
  ) {
    return matchOption(options, 'Denim');
  }

  const hit = MATERIAL_SIGNALS.find(([signal]) => stated.includes(signal));

  return hit === undefined ? null : matchOption(options, hit[1]);
}

export function suggestAttributes(input: {
  title: string;
  fields: readonly AttributeField[];
  variantLabels: readonly string[];
  supplierProperties: readonly SupplierProperty[];
  /** Decisions made outside the rules - in practice, off the photograph. */
  known: Readonly<Record<string, string>>;
}): SuggestedAttributes {
  const decided: Record<string, string[]> = {};
  const notes: string[] = [];

  // Known values are their own clauses, so the cascade works (naming a
  // product Cargo Pants makes the `cargo` fit signal fire) and a negation in
  // a supplier property cannot reach them.
  const clauses = [
    input.title.toLowerCase(),
    ...input.supplierProperties.map((property) => property.value.toLowerCase()),
    ...Object.values(input.known).map((value) => value.toLowerCase()),
  ];

  const fieldOf = (name: string) =>
    input.fields.find(
      (field) =>
        field.attributeName.trim().toLowerCase() === name.toLowerCase(),
    );

  const isFilled = (field: AttributeField) =>
    field.values.some((value) => value.trim() !== '');

  // 1. The caller's own answers - the photograph outranks every rule.
  Object.entries(input.known).forEach(([name, wanted]) => {
    const field = fieldOf(name);
    const match =
      field === undefined ? null : matchOption(field.allowedValues, wanted);

    if (field !== undefined && match !== null) {
      decided[field.attributeName] = [match];
      notes.push(`${field.attributeName}=${match} (photograph)`);
    }
  });

  // 2. Policy fields.
  input.fields.forEach((field) => {
    const wanted = POLICY_DEFAULTS[field.attributeName.trim().toLowerCase()];

    if (
      wanted === undefined ||
      isFilled(field) ||
      decided[field.attributeName] !== undefined
    ) {
      return;
    }

    const match = matchOption(field.allowedValues, wanted);

    if (match !== null) {
      decided[field.attributeName] = [match];
      notes.push(`${field.attributeName}=${match} (policy)`);
    }
  });

  // 3. Plus Size, read off the real size run rather than by eye.
  const plusField = fieldOf('Plus Size');
  const plus = derivePlusSize(input.variantLabels);

  if (
    plusField !== undefined &&
    plus !== null &&
    !isFilled(plusField) &&
    decided[plusField.attributeName] === undefined
  ) {
    const match = matchOption(plusField.allowedValues, plus);

    if (match !== null) {
      decided[plusField.attributeName] = [match];
      notes.push(`${plusField.attributeName}=${match} (size run)`);
    }
  }

  // 4. Material - the supplier's own property table only.
  const materialField = fieldOf('Material');

  if (
    materialField !== undefined &&
    !isFilled(materialField) &&
    decided[materialField.attributeName] === undefined
  ) {
    const material = materialFromProperties(
      input.supplierProperties,
      materialField.allowedValues,
      input.title,
    );

    if (material !== null) {
      decided[materialField.attributeName] = [material];
      notes.push(
        `${materialField.attributeName}=${material} (supplier property table)`,
      );
    }
  }

  // 5. The merchandising tables.
  input.fields.forEach((field) => {
    const rules = MERCHANDISING_RULES[field.attributeName.trim().toLowerCase()];

    if (
      rules === undefined ||
      isFilled(field) ||
      decided[field.attributeName] !== undefined
    ) {
      return;
    }

    const hit = Object.entries(rules).find(
      ([signal]) => signal !== 'default' && signalMatches(clauses, signal),
    );
    const wanted = hit === undefined ? rules.default : hit[1];

    if (wanted === undefined) return;

    const match = matchOption(field.allowedValues, wanted);

    if (match !== null) {
      decided[field.attributeName] = [match];
      notes.push(
        `${field.attributeName}=${match} ` +
          `(${hit === undefined ? 'category default' : `signal: ${hit[0]}`})`,
      );
    }
  });

  // 6. What still needs a person, by name and with its options - one field
  //    to look at, not fourteen.
  const pending = input.fields
    .filter((field) => {
      const requirement = field.requirement.toLowerCase();

      return (
        (requirement.includes('required') ||
          requirement.includes('recommended')) &&
        !isFilled(field) &&
        decided[field.attributeName] === undefined
      );
    })
    .map((field) => ({
      name: field.attributeName,
      requirement: field.requirement.toLowerCase().includes('required')
        ? 'required'
        : 'recommended',
      options: [...field.allowedValues],
    }))
    .sort((a, b) => {
      if (a.requirement !== b.requirement) {
        return a.requirement === 'required' ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    });

  return { decided, notes, pending };
}
