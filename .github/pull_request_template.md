## Summary

<!-- What changed and why. -->

## AJ's process rules (confirmed 2026-08-04/05 — see `docs/Wiki/wiki/team-profile-and-collaboration-preferences.md`)

- [ ] Branched off `develop` with the correct prefix — `feat/<feature-name>`, `chore/<small-change>`, or `bug/<fixed-issue>` — never committed directly to `main` or `develop`.
- [ ] This is a **fresh** branch, not more commits pushed onto a branch whose PR already merged. (`gh pr view --json state,mergedAt` on the source branch, if unsure.)
- [ ] Assignee and reviewer are set symmetrically and are **not the same person**: PR from Bogs → assignee Bogs, reviewer AJ. PR from AJ → assignee AJ, reviewer Bogs. No self-review, no self-merge, in either direction.

## Code gate — `docs/Wiki/wiki/nextjs-component-security-code-rules.md`

- [ ] Component architecture reviewed (no monolithic components, one main export per file, stateful logic extracted to hooks, files/functions kept small).
- [ ] Security requirements reviewed (server-side input validation, auth/authz on protected routes and server actions, no secrets exposed to the client) — or **N/A**, state why below.
- [ ] Cost-efficiency and image-optimization rules checked (no unnecessary paid services/dependencies, `next/image` used with stable dimensions) — or **N/A**, state why below.
- [ ] `README.md` updated if this change adds/changes a feature, setup step, package command, env var, runtime behavior, project structure, test workflow, or limitation.

## SEO / GEO / AEO discoverability — `docs/Wiki/wiki/sals3-geo-aeo-seo-strategy-proposal.md`

- [ ] If this PR adds, moves, or removes a page/route (PDP, category, cart, checkout, etc.), checked `docs/Wiki/wiki/parked-ideas-backlog.md` for GEO/AEO/SEO items whose unblock condition this route now satisfies.
- [ ] If this PR touches `generateMetadata`, JSON-LD/structured data, `robots.ts`, `sitemap.ts`, or `llms.txt`, confirmed no field is filled with a guessed/placeholder value — real data or gated behind an env var (see `sals3-skills.md` lesson 14).
- [ ] **N/A** — this PR doesn't touch routes, metadata, or structured data.

## Verification

- [ ] `npm run lint`
- [ ] `npm run format:check`
- [ ] `npm run typecheck:clean`
- [ ] `npm run build`
- [ ] `npm run test:run`
- [ ] `npm run test:e2e`
- [ ] `npm audit --audit-level=high`

(`npm run verify && npm audit --audit-level=high` runs the first six in one shot.)

## Notes / risks / N/A explanations

<!-- Anything skipped above and why, remaining risk, or follow-up needed. -->
