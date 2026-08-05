# Sals3 Portal

Sals3 portal application. Same tech stack as `sals3-ecommerce`:

- Next.js 16 (App Router) + React 19 + TypeScript (strict)
- Tailwind CSS 4 (via `@tailwindcss/postcss`)
- Zod for validation
- ESLint 9 (flat config: Airbnb + Next core-web-vitals + TypeScript + Prettier)
- Prettier
- Vitest + Testing Library (jsdom) for unit tests
- Playwright for E2E tests
- Husky + lint-staged git hooks (direct commits/pushes to `main`/`develop` are blocked)
- GitHub Actions `verify` workflow

## Setup

```bash
npm install
npx playwright install chromium
```

## Commands

| Command                   | What it does                                                                  |
| ------------------------- | ----------------------------------------------------------------------------- |
| `npm run dev`             | Start dev server at http://localhost:3001 (3000 belongs to `sals3-ecommerce`) |
| `npm run build`           | Production build                                                              |
| `npm run start`           | Serve production build                                                        |
| `npm run lint`            | ESLint                                                                        |
| `npm run format:check`    | Prettier check                                                                |
| `npm run typecheck:clean` | TypeScript check without `.next` artifacts                                    |
| `npm run test:run`        | Unit tests (Vitest)                                                           |
| `npm run test:e2e`        | E2E tests (Playwright)                                                        |
| `npm run verify`          | Full gate: lint + format + typecheck + build + unit + E2E                     |

## Current state

Blank home page (`src/app/page.tsx`) that renders "Hello world". No product code yet.
