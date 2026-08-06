# Page override — Seller Center Inventory

Inherits `../MASTER.md`. Only the differences are listed here. See also
`seller-center-shared.md`.

## Route map

| Route        | Purpose                                          |
| ------------ | ------------------------------------------------ |
| `/inventory` | Inline stock edits with undo and an audit record |

## Page anatomy (top to bottom)

1. **Header row** — page title `Inventory`, description.
2. **Stock table** — SKU/variant, location, reserved, sellable (computed as
   on hand minus reserved, red when at or below 10), and an inline on-hand
   quantity stepper. Every click is a real, audited change - there is no
   separate save step.
3. **Record of changes** and **Safety rules** panels, side by side. Every
   stepper edit appends a new line to the record (actor, old value, new
   value, source, time) and shows a toast with `Undo`; undoing appends
   another record line rather than deleting the original one, so the
   history never loses an entry.

## Mobile (< 768px)

Table rows collapse to stacked cards; the stepper stays reachable at the
44×44px touch-target minimum.

## Data reality, stated plainly

All data on this page is static, illustrative placeholder data in
`src/lib/seller-center/mock-data/inventory.ts`. No backend inventory system
exists in this repository yet - edits only change this browser tab's local
state and are lost on reload.
