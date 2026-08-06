# Page override — Seller Center Finances

Inherits `../MASTER.md`. Only the differences are listed here. See also
`seller-center-shared.md`.

## Route map

| Route       | Purpose                                            |
| ----------- | -------------------------------------------------- |
| `/finances` | Itemized ledger and proceeds for one example order |

Shows one illustrative order, not a list. `FinancesLedgerPanel` takes an
`orderId` prop so a real per-order route (`/orders/[id]/finances`, once
orders are real) is a page-level change, not a component rewrite.

## Page anatomy (top to bottom)

1. **Header row** — page title `Finances`, description.
2. **Itemized ledger** (left) — every revenue and fee line with its rule
   citation, totalling to "Estimated seller proceeds" with a settlement
   date. A `Pending` status pill states this is not final yet.
3. **Estimate to final variance** (right, top) — the typical estimate-to-
   settled gap as CSS bar meters by reason (no chart library, per
   `MASTER.md`).
4. **What is not in this number** (right, bottom) — plainly states costs
   this number excludes (goods, packaging, ads, labour) and why no margin
   figure exists yet.

## Mobile (< 768px)

Two-column layout stacks to one column; the ledger comes first.

## Data reality, stated plainly

All data on this page is static, illustrative placeholder data in
`src/lib/seller-center/mock-data/finances.ts`. No backend ledger or
settlement system exists in this repository yet.
