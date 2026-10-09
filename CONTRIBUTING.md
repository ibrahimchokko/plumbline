# Contributing to Plumbline

Thanks for helping. This page covers everything you need to send a good pull request.

## Setup

```bash
npm install
npm run dev:all        # mock backend :4000 + web app :5173, fully offline
npm run check          # typecheck + unit tests + production build. Run this before every PR.
```

You don't need a wallet, testnet keys or the real backend for most UI and CLI work. The mock backend (`infra/mock-backend.mjs`) covers them.

## Where things go

| Change | Put it in |
|---|---|
| A new backend call | `packages/core/src/api.ts` (+ types in `types.ts`, + a row in `docs/backend-contract.md`) |
| Pure logic (maths, parsing, filtering) | `packages/core/src/*` **with a unit test** in `packages/core/test` |
| A screen | `web/src/routes/` (see "Adding a screen" in `docs/architecture.md`) |
| A reusable UI piece | `web/src/components/ui.tsx` |
| User-facing text | `web/src/lib/i18n/en.ts` (TypeScript will then ask for `ar.ts`) |
| A CLI command | `cli/src/commands/` + register it in `cli/src/main.ts` + update `HELP` |

## Rules of the road

- **TypeScript strict, no `any`** unless it's commented as being for a third-party type gap.
- **Money is `bigint` stroops.** Never do arithmetic on USDC as a float.
- **Untrusted text is text.** No `dangerouslySetInnerHTML`. Use `SafeText` for question bodies.
- **Every async action shows progress and failure** (`Button busy`, plus `notify` or `scoped(...)`).
- **Don't load the SDK on first paint.** `import()` it where it's needed. CI's bundle budget will catch you.
- Keep the design tokens. New colours go in `styles/tokens.css`, for both themes.

## Issue template

```
### What
One sentence.
### Why
Who benefits.
### Done when
- [ ] observable result 1
- [ ] tests / screenshots
### Pointers
Files likely involved, related docs.
```

## PRs

- One focused change per PR. Link the issue (`Closes #12`).
- Include a screenshot or GIF for UI changes, light and dark.
- `npm run check` must pass. `npm run smoke` too, if you touched routes.

## Drips Wave

If you found this repo through Drips Wave, read [`docs/drips-wave.md`](docs/drips-wave.md). Apply for the issue in the Drips app and **wait to be assigned before you start coding**.
