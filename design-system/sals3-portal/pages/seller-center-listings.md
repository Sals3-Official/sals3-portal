# Page override — Add Product

Inherits `../MASTER.md`. Only the differences are listed here. See also
`seller-center-shared.md`.

## Route map

| Route                                | Purpose                                                               |
| ------------------------------------ | --------------------------------------------------------------------- |
| `/listings/new`                      | Blank Add Product wizard (essentials-first flow)                      |
| `/listings/new?fixture=<key>`        | Product Editor — supplier-prefilled, design preview                   |
| `/listings/new?supplierCandidateId=` | Reserved for the real integration; states that it is not wired up yet |
| `/listings/new?fixture=<key>&state=` | Development-only entry into a save/validation state                   |

There is no `/listings` index yet. The nav label says "Add Product" — one
route, two entry modes: a product the seller is adding themselves, or a
qualified supplier product being customized before publication. Product
Sourcing supplies the candidate; the listing belongs to Catalogue.

Both modes are reachable by clicking, never only by typing a URL: `Add
Product` carries `Blank product` and `From a supplier product` sub-items in
the rail, and the blank page opens with the same two-card choice.

Both preview modes (`?fixture=`, `?supplierCandidateId=`) set
`robots: noindex` — fictional and placeholder content sits on a real
production route and must not be indexed.

## Blank wizard (no query)

1. **Header row** — page title `Add Product`, description, and a
   two-card mode chooser (`Blank product` / `From a supplier product`).
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

### Mobile (< 768px)

The two-column layout stacks to one column; the rail moves below the
stage accordion.

## Product Editor (`?fixture=`)

1. **Preview notice** — states that the data is fictional and unsaved.
2. **Header** — breadcrumb, thumbnail, Product Name as the page `h1`,
   supplier identity + connection health, external product id, evaluation
   status, listing state, last checked, unsaved indicator, and the
   Readiness / Preview / Supplier Source Details triggers.
3. **State banners** — save failed, validation failed, connection
   unavailable, session expired, plus the fixture's own banner. Each states
   what happened, what it affects, what to do next, and what was _not_
   lost. A fixture-backed screen cannot reach these on its own, so `?state=`
   is how they are reviewed and tested — never a visible control strip,
   which belongs to the design artefact and not to a seller's screen.
4. **Listing Readiness** (left, 240px) — two tabs, `Issues & Tasks` and
   `Source Changes`. No AI tab, no per-warning approval step.
5. **Section navigation** — sticky jump list across the seven sections,
   each carrying the worst severity in its section as an icon _and_ a word.
   The current section follows manual scrolling through an
   `IntersectionObserver`, feature-detected so the click behaviour still
   works without it.
6. **Sections** — Basic Information · Category & Specifications ·
   Description · Variants & Pricing · Markets & Shipping · Media ·
   Review & Publish.
7. **Draft Storefront Preview** (right, 288px) — non-functional; its
   `Add to Cart` is a disabled button with no handler.
8. **Sticky action bar** — save + validation state in one
   `aria-live="polite"` region, then Exit / Save Draft / Publish. Pause and
   delist sit behind an overflow with a divider, never beside Publish.

### Field ownership

Editable: Product Name, Sals3 category, Seller SKU, brand declaration,
retail price, Sals3 SKU per variant. Supplier-controlled and read-only:
supplier product id, original name and category, supplier status, source
update time, supplier cost, stock, warehouse, variant identity.

Read-only evidence is a grey surface with a dashed border and a lock icon,
never a disabled control - it stays legible, selectable and copyable.

### Media

Two independent label families that must never be conflated: the
**rights check** (Verified / Pending verification / Rejected) and the
**storage state** (Supplier-hosted source / Pending import / Storage status
unavailable). "Verified" says an image is cleared for use, never that Sals3
holds a copy of it.

Reordering and cover selection are real and local. `Replace`, `Upload
image` and `Add video` are disabled with a `title` naming the missing
media/storage backend - a control that silently did nothing would be worse
than one that admits it.

### Bulk pricing

`Set retail price…` and `Apply markup…` both state their blast radius
before running: how many variants change, and how many are skipped.
Blocked and paused variants are never re-priced, and `Apply markup` skips
any variant with no landed cost rather than pricing it from a guess.

### Responsive

Layout responds to the editor's own **container** width, not the viewport,
so it reacts to the portal rail expanding rather than assuming a viewport
size. At/above 76rem of container width the three-column layout applies
(240px readiness · flexible centre · 288px preview). Below it both side
panels become full-width sheets opened from the header. This route never
collapses or overrides the seller's sidebar. The variant table always
scrolls inside its own container; the page never scrolls sideways.

## Data reality, stated plainly

All data on this page is static, illustrative placeholder data. The blank
wizard reads `src/lib/seller-center/mock-data/listings.ts`; the Product
Editor reads `src/lib/seller-center/mock-data/product-editor.ts`. Fields in
the wizard are read-only. The editor's fields are editable but nothing
persists: there is no server action, no endpoint, and no publication
backend, and a reload discards every change.

Three rules hold across the editor and are enforced in
`src/lib/seller-center/product-editor/derive.ts` rather than by review:

- an unknown amount renders as words ("Needs route check", "Not
  available"), never as `0`, and two currencies are never added;
- a missing required attribute is a blocker, a missing recommended one a
  warning, a missing optional one a suggestion;
- a blocked product never looks publishable — the publish button stays
  visible and prints why it is disabled.
