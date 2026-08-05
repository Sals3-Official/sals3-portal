# Sals3 mandatory code rules

This repository shares the Sals3 tech stack and operating rules with `sals3-ecommerce`. The canonical wiki lives in the sibling repository. Before any codebase edit, refactor, test change, configuration change, or package change, read and follow:

- `../sals3-ecommerce/docs/Wiki/wiki/hot.md`
- `../sals3-ecommerce/docs/Wiki/wiki/agent-operating-contract.md`
- `../sals3-ecommerce/docs/Wiki/wiki/nextjs-component-security-code-rules.md`
- `../sals3-ecommerce/docs/Wiki/wiki/project-structure-installation-and-runbook.md`

`nextjs-component-security-code-rules.md` is the strict source of truth for Next.js component architecture, server-side security checks, validation commands, and completion reporting. Do not mark code work complete when required lint, format, typecheck, build, test, E2E, or high-severity audit checks fail unless the failure is reported as a blocker.

Package manager is `npm` with `package-lock.json` as the lockfile. Run `npm run verify` before reporting code work complete.

Do not deploy, publish, push, or commit unless the owner explicitly asks.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
