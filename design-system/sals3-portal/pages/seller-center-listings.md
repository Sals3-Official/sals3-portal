# Page override — Seller Center Listings

Inherits `../MASTER.md`. Only the differences are listed here. See also
`seller-center-shared.md`.

## Route map

| Route           | Purpose                                            |
| --------------- | -------------------------------------------------- |
| `/listings/new` | New-listing wizard preview (essentials-first flow) |

There is no `/listings` index yet - only the wizard exists. The nav label
says "New listing", not "Listings", so the gap reads honestly.

## Page anatomy (top to bottom)

1. **Header row** — page title `New listing`, description.
2. **Stage accordion** (left, wider column) — 4 stages (Start / market
   requirements / Selling options / Quality and review), each a
   `StatusPill` (Complete / Blocked / N missing). Opening a stage reveals
   its fields; a field needing attention (the HS code) is tinted and
   carries inline plain-language help explaining why it applies. Bottom
   actions (`Continue`, `Save as draft`) are deliberately disabled with a
   `title` explaining why - no product-creation backend exists yet.
3. **Completeness rail** (right) — a progress bar, a fields-done count,
   and a checklist of what remains, each item marked required or optional.
4. **Estimated proceeds** (right) — price minus commission/fee/tax lines
   to an estimated total, with the shared "not profit, not guaranteed"
   disclosure.

## Mobile (< 768px)

The two-column layout stacks to one column; the rail moves below the
stage accordion.

## Data reality, stated plainly

All data on this page is static, illustrative placeholder data in
`src/lib/seller-center/mock-data/listings.ts`. Fields are read-only - this
shows what a filled-in listing looks like, it does not create or save one.
