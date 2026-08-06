# Page override — Seller Center Payouts

Inherits `../MASTER.md`. Only the differences are listed here. See also
`seller-center-shared.md`.

## Route map

| Route      | Purpose                                                        |
| ---------- | -------------------------------------------------------------- |
| `/payouts` | Payout schedule, states, and destination for the active market |

## Page anatomy (top to bottom)

1. **Header row** — page title `Payouts`, description names the active
   market.
2. **Payout schedule** (left, top) — daily/weekly/monthly/manual options;
   an option is disabled with its own explanatory note when the market's
   settlement window does not support it (e.g. daily payout in a market
   whose local window does not allow it). Selection is local to this
   browser tab - no backend exists to save it.
3. **Payout states** (left, bottom) — Deposited/Sent/Processing/Held/Failed,
   each with an amount, a plain-language note, and a trace ID (glossed once
   at the top of the panel, not repeated per row).
4. **Destination** (right) — masked bank/wallet detail, verification date,
   and payout threshold. "Change destination" opens a real confirmation
   dialog (`alert-dialog`) stating the re-authentication/notify/24-hour-hold
   friction; its Continue action is deliberately disabled (no backend to
   actually change a destination yet) rather than a silent no-op.

## Mobile (< 768px)

Two-column layout stacks to one column; schedule and states come first.

## Data reality, stated plainly

All data on this page is static, illustrative placeholder data in
`src/lib/seller-center/mock-data/payouts.ts`. No backend payout or
settlement system exists in this repository yet.
