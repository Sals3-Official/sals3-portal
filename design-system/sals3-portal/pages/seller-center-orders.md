# Page override — Seller Center Orders

Inherits `../MASTER.md`. Only the differences are listed here. See also
`seller-center-shared.md`.

## Route map

| Route     | Purpose                                    |
| --------- | ------------------------------------------ |
| `/orders` | Batch fulfillment: select, print, hand off |

## Page anatomy (top to bottom)

1. **Header row** — page title `Orders`, description names the active
   market's carrier and cutoff time.
2. **Filter chips** — plain links (`ready` / `cutoff today` / `sync failed` /
   `all open`), state lives in `?orderFilter=` so the view is shareable.
3. **Excluded-orders banner** — a warning-tone `DisclosureBanner` naming
   which orders are locked out of the current batch and why, shown whenever
   any order is locked.
4. **Orders table** — checkbox column (locked rows - failed sync or an
   unconfirmed address - cannot be checked), order/buyer, items, cutoff
   (red when due today), a `StatusPill` sync state, and estimated proceeds.
   Below `md` the row collapses to a stacked card.
5. **Sticky bulk-action bar** — appears only once at least one row is
   selected: selection count, estimated proceeds sum, a `Clear` link, and a
   `Print N labels` action. Printing clears the selection and shows a toast
   with an `Undo` action that restores it - nothing is actually sent to the
   carrier from this static build.
6. **Reprint history** and **Handoff** panels — a static log and a
   suggested-pickup summary. The Handoff panel's `Review` button is
   deliberately disabled (`title` explains why) rather than a silent no-op,
   since no pickup-review flow is built yet.

## Mobile (< 768px)

Table rows collapse to stacked cards (items/cutoff join one muted line).
The bulk-action bar stays reachable via `sticky`, never fixed-overlapping
content.

## Data reality, stated plainly

All data on this page is static, illustrative placeholder data in
`src/lib/seller-center/mock-data/orders.ts`. No backend order or label
system exists in this repository yet. "Print" only shows a toast - no label
is generated and nothing reaches a carrier.
