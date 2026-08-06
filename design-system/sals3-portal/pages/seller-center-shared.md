# Seller Center — shared conventions

Cross-cutting conventions used by all 7 Seller Center screens (Overview,
Orders, Inventory, Listings, Finances, Payouts, Market rules). Inherits
`../MASTER.md`. Per-screen anatomy lives in the sibling
`seller-center-<screen>.md` files.

## Market configuration

`src/lib/seller-center/market-config.ts` exports `getActiveMarket()`, which
reads the server-only `PORTAL_DEV_MARKET` env var (falls back to `PH`) and
returns one of 3 illustrative sample markets (Philippines, Indonesia,
Singapore). This mirrors `src/lib/auth/session.ts`'s `readDevRole()`
placeholder pattern - same shape, same honesty about not being real
per-seller configuration yet.

**Every value on these three markets is illustrative** - currency, carrier
name, cutoff time, tax label, payout rail, rule version. None are confirmed
Sals3 launch markets or approved fee/tax figures. This is deliberately a
static, code-reviewed config module, not a self-serve configuration console

- consistent with this project's Seller Center UX blueprint, which explicitly
  cuts a self-serve multi-market console from v1.

`src/lib/seller-center/money.ts` formats amounts (integer minor units)
against the active market's currency/locale via `Intl.NumberFormat`. This is
intentionally not a port of `sals3-ecommerce`'s `money.ts` (that one is
single-currency, PHP-only, correct for a PHP-only storefront but wrong for a
multi-market concept).

## Shared components

`src/components/seller-center/shared/`:

- **`DisclosureBanner`** — muted (`info`) or warning-tinted (`warning`)
  panel for stating a limit, an estimate's uncertainty, or a
  friction-by-design behavior. Used on Overview (variance note), Listings
  (proceeds estimate), Payouts (destination-change friction).
- **`StatusPill`** — badge mapped to 5 tones (`neutral`/`info`/`success`/
  `warning`/`danger`) using `MASTER.md`'s status-surface tokens. Colour is
  never the only signal - the label text always states the status in words.
- **`StatTile`** — a `StatusPill` plus a large amount plus an explanatory
  note, the "one number, always with its meaning" building block for
  Overview's money position.

## Shared copy

`src/lib/seller-center/disclosures.ts` holds plain-language copy constants
referenced by more than one screen (the "not profit, not guaranteed" note,
the payout-destination-change warning, the trace-ID gloss, the
concurrent-edit-conflict explanation) so the same idea is written once and
stays consistent everywhere it recurs. Every string here is written to the
project's ASD-STE100 / elementary-reading-level rule: pair any necessary
term with an ordinary-words explanation instead of assuming the reader
already knows it.

## Data reality, stated plainly

No order, inventory, finance, or payout backend exists in this repository.
Every screen's mock data lives in its own file under
`src/lib/seller-center/mock-data/`. What is real: the permission gate on
every route, the on-screen interactions, and the `sonner` toast + Undo
pattern - those genuinely change browser-tab state and can genuinely be
undone; none of it persists past a reload or reaches a backend.
