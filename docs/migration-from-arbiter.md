# Migration notes: from arbiter-app to Plumbline

Plumbline keeps the functionality of `arbiter-app` and its compatibility with the Arbiter backend API and Soroban contract. Everything else was rebuilt. This page covers what changed, why, and how to map old names to new ones.

## 1. Format and language

| | arbiter-app | Plumbline |
|---|---|---|
| Language | Plain JavaScript (no types) | **TypeScript (strict)** everywhere |
| UI | 9 separate HTML pages, each with its own script and its own wallet connect | **One React SPA** with a router and one wallet session |
| Shared logic | Copy-pasted between pages (and drifted apart) | **`@plumbline/core`** package, shared by web and CLI |
| Demo tooling | 7 separate Node scripts with overlapping code | **One `plumb` CLI** with subcommands |
| Landing site | Separate static site + its own i18n | The `/` route of the app |
| Tests | Visual snapshots only; no unit tests | **Unit tests** for all core logic + a browser **smoke test** |
| Local backend | Needed the real backend repo | **Mock backend** included (`npm run mock`) |

## 2. Name map

| Arbiter | Plumbline | Note |
|---|---|---|
| Worker | **Verifier** | Backend paths still use `/workers/*` |
| Payer / buyer | **Asker** | Backend paths still use `/payers/*` |
| Worker console (`index.html`) | **Verify & earn** (`/verify`) | |
| Buyer dashboard (`dashboard.html`) | **Ask** (`/ask`) | Can now actually *ask* |
| Leaderboard (`leaderboard.html`) | **Standings** (`/standings`) | |
| Worker profile (`worker.html?address=`) | **Verifier profile** (`/v/:address`) | Old URL still works |
| Status (`status.html`) | **Health** (`/health`) | |
| Customer (`customer.html`) | **API account** (`/account`) | |
| Admin (`admin.html`) | **Control room** (`/control`) | |
| Demo feed (`demo.html`) | **Live wire** (`/live`) | |
| Stake | **Bond** | |
| Quick-start wallet | **Built-in wallet** | Old wallets are migrated automatically |
| `ask.js` | `plumb ask` | |
| `sandbox-demo.js` | `plumb sandbox` | |
| `worker-sim.js` | `plumb verifier` | (`plumb worker` alias) |
| `sponsored-demo.js` | `plumb sponsored-proof` | |
| `run-scenario.js <name>` | `plumb scenario <name>` | + new `disagreement` scenario |
| `sandbox-ask.js` (bot) | `plumb bot` | |
| `widget.js` / `data-arbiter-widget` | `embed/ask-widget.js` / `data-plumbline-ask` | Old attribute still picked up |
| `status-widget.js` | `embed/status-badge.js` | |

Existing users lose nothing. A plaintext quick-start secret found in `localStorage` (`arbiter_local_wallet_secret`), or a hardened wallet in the `arbiter-wallet` IndexedDB, is migrated into Plumbline's hardened signer on first open.

## 3. Bugs in the original that are fixed

| # | Original bug | Effect | Fix |
|---|---|---|---|
| 1 | `main.js` called `createWalletKit()` without importing it | Worker console crashed on load | Single wallet module, lazy-loaded |
| 2 | `COMPATIBLE_BACKEND_VERSION` used but never defined | Version check threw | Build-time constant + **semver** comparison |
| 3 | Stake form ran leftover connect-wallet code | **Staking never staked** | Real `stake()` build → sign → `/sponsor/stake` |
| 4 | `dashboard.js` imported a non-existent `session.js` | Buyer dashboard failed to load | `SessionProvider` shared by every route |
| 5 | `wireConnectButtons`, `setConnectButtonsBusy`, `createStarButton`, `renderFencedCode`, `notify` used without imports | Multiple `ReferenceError`s | Proper modules |
| 6 | Admin `canView()` and `SVG_NS` undefined | Overview and fraud chart crashed | 403 → "restricted"; React SVG chart |
| 7 | `leaderboard.js` used `formatUsdc` without importing it | Leaderboard crashed | Shared formatter |
| 8 | `worker.js` imported a missing `workerOgImageUrl` | Profile page crashed | Rebuilt profile route |
| 9 | `sandbox-ask.js` used `require` in an ESM package | Bot crashed on start | `plumb bot` |
| 10 | `index.html` loaded a missing `apikey.js` | API-key panel dead | API account route |
| 11 | `LedgerModule` imported from a path the kit doesn't export | Build break if bundled | Opt-in Ledger gated at build time |
| 12 | Version check required an exact string match | False "mismatch" on any patch release | Semver rules |
| 13 | Wallet-kit network hard-coded to TESTNET in some files, env var in others | Signing could use a different network than building | One `config.network` |
| 14 | Dispatch drop set the worker offline silently | Missed paid questions | Auto-reconnect with backoff + session refresh |
| 15 | Spend calendar code never called | Feature invisible | Rendered on Ask |
| 16 | Social recovery: functions existed, no UI | Unusable | Split / restore dialogs |
| 17 | Shamir used `Math.random()` as a fallback | Predictable shares | Secure RNG required; checksummed shares |
| 18 | Biometric unlock exported, never used | Dead code | Optional passkey gate before revealing a key |
| 19 | `posthog-js` dynamically imported but not a dependency | Build/runtime failure if enabled | Removed; Sentry kept, opt-in and scrubbed |
| 20 | Three different notification systems | Inconsistent | One `notify()` → toast + inbox + activity log |

## 4. New features

- **Ask from the browser**: quote → sign `submit()` → zero-XLM `/sponsor/pay` → live settlement, with image attachments.
- **Partial withdrawals** and payout to another address with full checksum validation.
- **Several wallets at once**, switchable from the header.
- One sign-in per tab (de-duplicated, cached until a minute before expiry).
- **Practice mode** for new verifiers, plus **answer drafts** and a **character counter**.
- **Personal ledger book** for tax records (CSV).
- Standings sorting and search. Health page response-time history.
- Control room: transaction search, CSV export on every table, adjustable trust threshold, low-balance alarms, network/build panel, compact rows.
- **Offline app shell** in the service worker; notification click opens `/verify`.
- Shadow-DOM isolated **ask widget**.
- Dark mode, and Arabic plural forms done properly (zero/one/two/few/many/other).
- CLI: `status`, `refund`, `disagreement` scenario, `--json`, `--sponsored`, durations like `30s` / `10m`.
- Mock backend, Docker compose with simulated verifiers, CI bundle budget and smoke test.

## 5. Things intentionally unchanged

- Every backend HTTP endpoint, header and body shape (see [`backend-contract.md`](backend-contract.md)).
- Contract methods: `submit`, `stake`, `withdraw`, `withdraw_to`, `refund_timeout`.
- Security posture: text-only rendering of untrusted data, formula-safe CSV, scrubbed telemetry, a non-extractable local key.
