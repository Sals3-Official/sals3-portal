# Page override — Seller Center Market Rules

Inherits `../MASTER.md`. Only the differences are listed here. See also
`seller-center-shared.md` (`StatusPill`, `DisclosureBanner`).

> **Design brief note (2026-08-13):** the "Category pricing" and "FX
> adjustment" sections described below are being redesigned. Section 3
> (Category pricing) and section 4 (Funding buffer, renamed from FX
> adjustment) describe the **target** design, not what ships today. Section
> 5 (Policy history) is entirely new. Everything else on this page (sections
> 1, 2) is unchanged and already real. Treat sections 3–5 as the actual
> design task; sections 1–2 are context so the new pieces sit coherently on
> the same page.

## Route map

| Route           | Purpose                                                               |
| --------------- | --------------------------------------------------------------------- |
| `/market-rules` | This account's real market setup, roles, and commercial pricing rules |

## Page anatomy (top to bottom) — current, unchanged

1. **Header row** — page title `Market rules`, description "What this
   account is set up to sell, and the commercial rules it applies."
2. **Your market setup** — real, persisted per-seller destination profile
   (AU/PH bounded pilot). Unaffected by this redesign; not part of this
   brief.
3. **Roles panel** (`MarketRolesExplainerPanel`) — two roles described
   against the real permission allow-list. Unaffected by this redesign.

Below the roles panel, in this order, are the two sections this brief
covers:

## 3. Category pricing (redesign target)

**What it's for**: the seller's target margin, set per Sals3 taxonomy
category — described in copy as "the normal default." Product/variant
overrides exist elsewhere in the system (Product Editor) and are out of
scope for this page.

**Why it's being redesigned**: the taxonomy has 1,345 leaf categories
across 29 top-level departments and 226 department-subdepartment (`L1>L2`)
groups. The old flow (search → pick one of 1,345 → open a form dialog →
save, one at a time) makes a routine setup task feel like data entry.
**No modal/dialog anywhere in the new design.** Everything is inline,
directly in a list.

### Structure: grouped list, not a flat table

One row per **L2 group** (`L1 department > L2 sub-department`, e.g.
"Digital Goods, Services & Subscriptions > Streaming & Online Services") —
226 rows total, always all visible (a group with nothing configured yet
still appears, showing an unset state — never hidden). Each group row
expands to reveal its individual leaf categories (anywhere from 1 to ~30
per group).

**Group row (collapsed), left to right:**

| Element                    | Content                                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expand chevron             | Toggles the leaf list below it. Only one group expanded at a time.                                                                                             |
| Group name                 | `{L1} > {L2}` — truncate the L1 half first if space is tight, L2 is the more specific/useful part.                                                             |
| Coverage                   | `{N}/{M} set` — e.g. `4/12 set` — small, muted, secondary to the group name.                                                                                   |
| State badge (`StatusPill`) | One of three states — see table below.                                                                                                                         |
| Inline margin input        | A `%` number input. Empty/placeholder when state is "Not set."                                                                                                 |
| Inline rounding select     | Two options: "None — exact price" / "Nearest .99".                                                                                                             |
| Inline reason input        | Single-line text, required before Save is enabled — same 10-character minimum as today, but here it's a plain `Input`, not a `Textarea`, sized to fit the row. |
| Save button                | Label and behavior change with state — see "Save interaction" below.                                                                                           |
| History icon               | Small icon-only button (clock/history glyph), opens the Policy history popover (section 5) scoped to this group's bulk-apply history.                          |

**Group state badge — three states, color never the only signal (label
text always present per MASTER §6 rule 1):**

| State   | When                                                                        | Badge label                                  | Badge tone       |
| ------- | --------------------------------------------------------------------------- | -------------------------------------------- | ---------------- |
| Not set | zero leaves in the group have an active policy                              | "Not set"                                    | neutral/muted    |
| Uniform | every leaf has an active policy and they all share the same rate + rounding | `{rate}%`                                    | success/positive |
| Mixed   | some leaves have policies but they differ, or only some leaves are set      | "Mixed" + a small range hint, e.g. "12%–30%" | warning          |

**Save interaction — inline, two-step, never a dialog:**

- **Not set** group: typing a % and clicking Save commits immediately.
  Nothing to overwrite, so no warning step.
- **Uniform** or **Mixed** group: the _first_ click on Save does not save.
  It reveals an inline warning line directly beneath the input row (same
  row's visual block, not a popup) — e.g. _"This will overwrite 12 of 12
  categories currently priced under Streaming & Online Services."_ — and
  the button itself changes to an armed, destructive-styled state reading
  "Confirm: overwrite 12". A _second_ click commits. Editing any of the
  three inputs after arming, or a small inline "Cancel" text link next to
  the armed button, disarms it back to normal without saving. If the group
  is Mixed, the warning additionally names how many leaves currently differ
  from the value being typed, e.g. _"...including 3 set to a different
  rate."_

  This is the same "state the blast radius before it runs" idea already
  used elsewhere in this product for bulk actions — just inline here
  instead of inside an `alert-dialog`, because the whole point of this
  redesign is removing dialogs from this flow.

**Expanded group — leaf list:**

Each leaf category gets its own row, indented under the group, with:
category path + stable code (small, muted, monospace — e.g.
`CAT-DIG-100801`), its own inline `%` + rounding + reason + Save (same
three-field shape as the group row, but this one only ever affects this
single leaf — no overwrite-warning step needed, since it's already
single-target), its own current version (`v3`) and last-updated date, a
history icon (this leaf's own full history, section 5), and — only when it
already has an active policy — a "Deactivate" button (destructive-styled,
text button, no icon needed) that still confirms via the existing
`alert-dialog` pattern (deactivation is rare/final enough to warrant that;
this redesign's "no dialog" rule applies to the _setup_ flow, not to
destructive confirmation, which MASTER §6 rule 4 already mandates a
dialog for).

### Search / filter bar

Sits above the grouped list, a single text input, placeholder like "Search
by department or category…". Filters the already-loaded 226 groups (and,
within an expanded one, its leaves) by matching L1, L2, leaf path, or leaf
code — client-side, instant, no loading spinner (there is no network
round-trip on keystroke in the new design). Groups with zero matching
leaves after filtering are hidden; a group whose L1/L2 name itself matches
stays visible even if you haven't expanded it to see which leaf matched.

### Empty/error state (whole section)

If the category-pricing data genuinely cannot be read (backend/migration
problem, not "nothing configured yet" — those are different states), the
whole grouped list is replaced by a `DisclosureBanner` (warning tone): "Category
pricing is not available right now." No search bar, no group rows, no
"Add" control — a broken read must never look like an empty-but-writable
list.

## 4. Funding buffer (redesign target, renamed from "FX adjustment")

**What it's for**: a single, seller-set percentage buffer that protects
margin from currency movement when the seller personally converts their
own funding currency to top up a supplier wallet (concretely: converting
AUD to top up the CJ Wallet, which only holds USD/EUR). **This is not a
buyer-facing currency conversion, not a markup, and not optional** — until
one is set, category-margin price guidance is unavailable everywhere on
the platform, so this section's empty state must say so plainly, not
imply it's a nice-to-have.

**Why it's being redesigned**: the old design asked for a source currency,
a target currency, and a funding-rail choice — a 5-field form for what is
really one number. Only one buffer can ever be active per seller at a
time.

### Structure: one card, not a table

Because there is at most one active buffer per seller, this section is a
single content card (not a table with headers) — reuse the same `<article>`
card shape already used for "Your market setup"'s profile card elsewhere
on this page (header row with a name/status pill, a small detail grid,
an action row), for visual consistency between the two sections on this
page.

**Card, when a buffer is active:**

- Header row: label "Funding buffer", the signed percentage large and
  prominent (e.g. `+3.00%`), a small `v{version}` badge.
- Detail line: "Last changed {date}" and the stored reason text.
- Actions row (only if the signer can manage pricing): "Edit" (opens the
  same inline % + reason inputs — no modal, matching section 3's rule) and
  "Deactivate" (destructive text button, confirms via `alert-dialog`, same
  reasoning as leaf deactivation above).
- History icon: this buffer's full change history (section 5).

**Card, when no buffer is active yet (the real, common first-run state):**

A `DisclosureBanner` (warning tone, not neutral — this blocks pricing) reading
something like: _"No funding buffer set. If you convert your own money
(e.g. AUD) to top up a supplier wallet like CJ Wallet, set a buffer here so
that conversion cost is reflected in every price. Category-margin pricing
is unavailable until one is set."_ — followed by the inline "Set a buffer"
input row (same shape as editing: a `%` input + reason input + Save,
first-time save commits immediately, nothing to overwrite).

**Inline edit fields** (both create and edit): signed percentage input
(placeholder examples both a positive and negative value are valid, bound
roughly ±20%), a single-line reason input, Save button. No currency
fields, no funding-rail selector — those concepts are gone from this UI
entirely.

## 5. Policy history (new, shared by sections 3 and 4)

**What it's for**: every category-margin and funding-buffer change is
already recorded (who, when, what changed, why) but today nothing shows
it. This is the first UI surface for that record.

**Trigger**: a small icon-only button (history/clock glyph, `aria-label`
required per MASTER §6 rule 2) placed next to: each category leaf row,
each category group row (bulk-apply history only), and the funding-buffer
card.

**Presentation**: a `Popover` (not a dialog — anchored near the button,
dismissible by clicking away, doesn't block the rest of the page), sized
for a short scrollable list, title stating what it's history _of_ (e.g.
"History — Prepaid Airtime" or "History — Streaming & Online Services
(bulk changes)" or "History — Funding buffer").

**Each history entry, most recent first:**

- Date and time.
- Who — the actor's name (falling back to email, or a raw identifier if
  neither is available — never blank).
- What happened — a short, plain-language label: "Created", "Revised",
  "Deactivated" (never the internal action-code string).
- The reason text they gave at the time.
- The value, when applicable — e.g. "Margin set to 15%" or, for a revision,
  a from→to form if both are known.

**Empty state** (a leaf/group/buffer with genuinely zero history — should
be rare since creation itself is an event): "No history yet."

**Loading state**: a small inline skeleton/spinner inside the popover
while the entries load — never a blank flash.

## Mobile (< 768px)

Section 3's grouped-list rows collapse the inline % / rounding / reason
inputs to stack vertically within the row (matching MASTER §4's existing
"row collapses to a stacked card below `md`" rule) rather than
horizontally scrolling; the Save/Confirm button stays full-width once
stacked. Section 4's card stacks its detail grid to one column. History
popovers anchor to the trigger and clamp to viewport width, per the
existing `Popover` component's default behavior — no special mobile
variant needed.

## Data reality, stated plainly

Category pricing and the funding buffer are real, persisted, per-seller,
audited configuration — not mock data (unlike most of the rest of Seller
Center, see `seller-center-shared.md`). What is **not** yet true: no real
product today has a Sals3 category actually mapped to it end-to-end, so
even a fully-configured category margin has no real product to apply to
yet — that gap is tracked separately and is not something this page's
design needs to solve or hide.
