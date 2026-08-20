---
tags:
  - session
  - sals3-portal
  - product-editor
  - pricing
  - seller-margin
created: 2026-08-21
status: implemented
authority: implementation-state
related:
  - "[[hot]]"
  - "[[agent-operating-contract]]"
  - "[[nextjs-component-security-code-rules]]"
---

# Sals3 Session 2026-08-21 Part 60 - Retail Price Above Supplier Cost

## Context

The seller-facing Product Editor allowed a listed variant's retail price to be
set equal to supplier cost. Screenshots showed retail prices such as `$1.10`
against `$1.10` supplier cost, and later `$4.29` against `$4.29` supplier cost.
That is not a valid listing state because the seller has no gross spread before
fees, freight, refunds, payment rails, tax handling, or operating costs.

## Owner Decision

Retail price must be strictly above stored supplier cost for every listed
variant when both prices are in the same currency. Equal-to-cost is not a
seller choice the platform should pass through as ready, because it records a
zero-spread offer as publishable.

## Implementation

`sals3-portal` PR #158 first closed the server-side and readiness gap:

- `publishProduct` now rejects manual retail prices at or below supplier cost.
- The Product Editor readiness model reports a blocker when a listed variant is
  priced at or below supplier cost.
- The visible retail-price warning copy says the price must be above supplier
  cost.
- Regression tests cover equal-to-cost publication refusal.

`sals3-portal` PR #159 then closed the editor-entry gap found in the follow-up
screenshot:

- Manual per-row retail edits clamp an equal-to-cost entry up to the next minor
  currency unit above supplier cost.
- The bulk "Set retail price" dialog computes the floor from affected variants
  and disables Apply when the entered value is equal to or below the highest
  affected supplier cost.
- Regression tests cover the manual and bulk same-cost paths.

## Verification

Focused verification passed for the pricing/editor changes:

```bash
npm run test:run -- src/components/products/editor/ProductEditor.test.tsx src/components/products/editor/VariantPricingTable.test.tsx src/modules/catalog/products/publish.test.ts
```

The focused suite passed with 95 tests. A later `npm run verify` attempt passed
lint, formatting, typecheck, build, and the full unit suite, then local
Playwright E2E was blocked by a Windows browser-launch permission failure:
`browserType.launch: spawn EPERM` for the Playwright Chromium executable under
`C:\Users\Bogs\AppData\Local\ms-playwright`.

`npm audit --audit-level=high` was also blocked in the sandbox by the npm
registry audit endpoint and inability to write npm cache logs under
`C:\Users\Bogs\AppData\Local\npm-cache\_logs`.

## Current State

As of 2026-08-21, the pricing rule is implemented in code and protected at
three layers:

- editor entry behavior;
- local readiness gating;
- server-side publish validation.

No CJ call was added. The rule uses persisted supplier-cost evidence already
available to the editor and publish path.
