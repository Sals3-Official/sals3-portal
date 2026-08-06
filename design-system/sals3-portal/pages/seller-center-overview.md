# Page override — Seller Center Overview

Inherits `../MASTER.md`. Only the differences are listed here. See also
`seller-center-shared.md` for the market-config mechanism and shared
components (`DisclosureBanner`, `StatusPill`, `StatTile`) this page uses.

## Route map

| Route       | Purpose                                                 |
| ----------- | ------------------------------------------------------- |
| `/overview` | Seller Center dashboard: what needs action, money state |

## Page anatomy (top to bottom)

1. **Header row** — page title `Overview`, description `What needs you now,
and what the money looks like`.
2. **Needs action now** — up to 3 task cards (`StatusPill` tone + count +
   deadline + one-sentence explanation + a CTA link into the screen that
   resolves it). Required work only — never mixed with growth suggestions.
3. **Money position** — 3 `StatTile`s side by side (Estimated / Pending /
   Final), never collapsed into one number, plus a warning-tone
   `DisclosureBanner` stating the last cycle's estimate-to-final variance
   and its top reason. An "Open ledger" link goes to `/finances`.
4. **Today at a glance** — a bordered row list of counts (orders processed,
   missed cutoffs, duplicate shipments, sync failures, listings missing a
   required attribute), each value tinted by tone so a zero reads as good
   and a non-zero exception reads as a warning/danger colour, never colour
   alone (the label always states what the number means).
5. **Growth suggestions** — optional, dismissible for the session via a
   client-side mute toggle (no persistence - see "Data reality" below).
   Visually and functionally separate from the required task cards above.

## Mobile (< 768px)

Task cards and the Today-at-a-glance/Growth-suggestions pair stack to a
single column. Nothing scrolls the page sideways.

## Data reality, stated plainly

All data on this page is static, illustrative placeholder data in
`src/lib/seller-center/mock-data/overview.ts`. No backend order, inventory,
or finance system exists in this repository yet. The "Mute 30 days" toggle
is in-memory only for this page load - it does not persist across a reload,
since there is no user-preference storage yet.
