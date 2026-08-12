# Product Sourcing — page overrides

Overrides `../MASTER.md` for `/products/pipeline`. Everything not stated here
follows Master.

## Candidate detail drawer

A read-only side panel, opened by clicking any row in any tab.

### Width

85% of the viewport from `md` up; **full width below `md`**. 85% of a 375px
phone leaves a 56px strip that is also the backdrop's dismiss target and sits
under a thumb.

The shared `sheet` primitive has **two** right-side width defaults —
`data-[side=right]:w-3/4` and `data-[side=right]:sm:max-w-sm` (24rem) — and both
must be overridden with the same modifier set so `tailwind-merge` treats each as
a conflict. Forgetting `sm:max-w-none` renders a 384px panel against a 768px
viewport, which looks like "the width didn't apply".
`CandidateDetailSheet.test.tsx` asserts these classes for exactly that reason.

### Structure

Header and tab bar are pinned; only the panel body scrolls (`min-h-0 flex-1
overflow-y-auto` on the body, never `overflow-y-auto` on `SheetContent`). A tab
bar that scrolls out of reach defeats tabbing.

Five tabs, in order: Overview · Stock · Supplier evidence · Screening & queue ·
History. `TabsList variant="line"`, wrapped in `overflow-x-auto` with
`min-w-max`, because five triggers cannot wrap inside an `inline-flex h-8` list.

The active tab is **not** in the URL — the page already owns `?tab=` for the
pipeline's own tab bar. Use `?section=` if deep-linking a tab is ever wanted.

### Accessible name

Do not set `aria-label` on `SheetContent` here. base-ui already points
`aria-labelledby` at `SheetTitle`, which wins under the accessible-name spec, so
an `aria-label` reads as a working override while doing nothing. The dialog's
name is therefore the product name, and tests address it as
`getByRole('dialog')` with no name.

### Empty states — three kinds, never interchangeable

| Kind                               | Border                                      | Pill    | Timestamp  | Role   |
| ---------------------------------- | ------------------------------------------- | ------- | ---------- | ------ |
| Never fetched from CJ              | dashed `border-border-strong` on `bg-muted` | neutral | **never**  | `note` |
| CJ reported zero                   | solid `border-border` on `bg-card`          | warning | **always** | —      |
| Never recorded (append-only table) | none                                        | none    | —          | —      |

The timestamp is the discriminator and is not optional. See the README section
"Candidate detail drawer" for why this distinction is load-bearing.

### Key-value rows

Use the shared `DetailRow`/`DetailSection` from `src/components/portal/`. Do not
add a fourth local variant — three already existed before these were extracted.
A caveat that qualifies a number goes in that row's `hint`, never in a footnote
at the bottom of the section.
