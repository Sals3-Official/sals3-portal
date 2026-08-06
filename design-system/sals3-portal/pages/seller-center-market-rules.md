# Page override — Seller Center Market Rules

Inherits `../MASTER.md`. Only the differences are listed here. See also
`seller-center-shared.md`.

## Route map

| Route           | Purpose                                             |
| --------------- | --------------------------------------------------- |
| `/market-rules` | Every rule applied to the account, plus role access |

## Page anatomy (top to bottom)

1. **Header row** — page title `Market rules`, description names the
   active market and its rule-set version.
2. **Rules table** — name, scope, source, effective date, version. Rows
   deliberately echo the exact citations already shown on Orders (cutoff),
   Finances (commission/transaction fee/tax), and Payouts (threshold) - this
   screen is a cross-reference, not a rule list invented in isolation.
3. **Roles panel** — two roles (Owner/`seller_manager`,
   Staff/`seller_staff`), described in the same terms this repository's
   actual `ROLE_PERMISSIONS` allow-list enforces (`src/lib/auth/permissions.ts`)
   - Staff cannot open Finances or Payouts, matching the real permission
     check, not just a UI claim.

## Mobile (< 768px)

The rules table collapses to stacked rows (scope/source/effective date
join the row); the roles panel stacks to one column.

## Data reality, stated plainly

Rule rows in `src/lib/seller-center/mock-data/market-rules.ts` are
illustrative examples. The role descriptions are accurate to what this
repository's permission system actually enforces today.
