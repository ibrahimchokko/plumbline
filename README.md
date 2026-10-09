<div align="center">

# Plumbline

**Ask a question. People with money on the line answer it. Stellar settles the bill.**

A staked human verification oracle on Stellar / Soroban. This repo holds the web app, a typed SDK core, and the `plumb` command-line tool.

`TypeScript` · `React 18` · `Vite` · `Soroban` · `USDC` · `Apache-2.0`

</div>

---

## Contents

1. [What Plumbline is (plain English)](#1-what-plumbline-is-plain-english)
2. [A walk-through: one question, start to finish](#2-a-walk-through-one-question-start-to-finish)
3. [Who uses it](#3-who-uses-it)
4. [Run it in 3 minutes (no blockchain needed)](#4-run-it-in-3-minutes-no-blockchain-needed)
5. [Run it against a real backend on testnet](#5-run-it-against-a-real-backend-on-testnet)
6. [The web app, screen by screen](#6-the-web-app-screen-by-screen)
7. [The `plumb` CLI](#7-the-plumb-cli)
8. [Embeds: ask box and status badge](#8-embeds-ask-box-and-status-badge)
9. [How the code is organised](#9-how-the-code-is-organised)
10. [Configuration reference](#10-configuration-reference)
11. [Money and safety guarantees](#11-money-and-safety-guarantees)
12. [Testing and CI](#12-testing-and-ci)
13. [Glossary](#13-glossary)
14. [FAQ and troubleshooting](#14-faq-and-troubleshooting)
15. [Contributing, credits and license](#15-contributing-credits-and-license)

---

## 1. What Plumbline is (plain English)

Say you need a fact checked, and being wrong would cost you. An audit finding. Whether a smart contract really behaves the way its docs claim. Something an AI told you confidently.

You could ask a chatbot, but if it's wrong, nothing happens to it. You could ask strangers online, but nobody is accountable either.

**Plumbline adds a cost to being wrong.**

1. You **ask** and pay a small, fixed price in USDC (a dollar-pegged token). The price starts at $0.05.
2. The money goes into an **escrow**: a smart contract on the Stellar blockchain. Plumbline the company never holds it.
3. Your question goes out, in real time, to a group of **verifiers** who know that topic. Many of them have put up a **bond**, a deposit they can lose.
4. They answer independently. If enough of them **agree** (a *quorum*), the contract pays the ones who agreed. If they don't agree, the contract **refunds you in full**.
5. Verifiers whose answers lose the vote can **forfeit part of their bond**. Being right builds a public track record. Being careless costs money.

> **Analogy.** Think of a quiz-show panel where each panelist puts $5 on the table before answering. Whoever agrees with the majority splits your fee. Whoever doesn't loses some of their $5. If the panel can't agree, you get your money back. A referee you can't bribe holds the money: a public smart contract.

Two design choices make it friendly for beginners:

- **No XLM needed.** Every Stellar transaction normally costs a tiny fee in XLM, Stellar's native coin. Plumbline **sponsors** those fees, so a brand-new wallet holding zero XLM can still ask, answer, stake and withdraw.
- **No wallet needed, if you prefer.** Use the **built-in browser wallet** (one click), or skip crypto entirely with an **API key** paid by card.

---

## 2. A walk-through: one question, start to finish

**Scenario:** Amina runs a small DeFi audit firm in Lagos. Before she publishes a report she wants an independent check: *"Does Soroban allow re-entrant contract calls?"* She picks the **Standard** tier: two verifiers must agree, within 20 seconds.

```
 Amina (asker)                 Plumbline server                Escrow contract (Soroban)          Verifiers (Tunde, Grace, Musa)
      |  POST /oracle  ─────────────▶ |                                    |                                   |
      |  ◀──── 402 "0.25 USDC, id 9001" (price LOCKED to this question)    |                                   |
      |  sign submit(Amina, 9001, 0.25) ──▶ /sponsor/pay ── fee-bump ─────▶|  holds 0.25 USDC                  |
      |  POST /oracle + proof ──────▶ |  202 jobId                          |                                   |
      |                               | ── dispatch over live channel ─────────────────────────────────────▶ | (all three online for "coding")
      |                               | ◀──────────────────────────────── "No"   (Tunde)                     |
      |                               | ◀──────────────────────────────── "No"   (Grace)  → quorum of 2 ✓     |
      |                               | ── resolve(9001, [Tunde, Grace]) ─▶|  credits Tunde & Grace            |
      |  ◀── "Answered: No" (live) ── |                                    |                                   |
```

- **Amina** sees the answer on her Ask page within seconds. The update arrives live; there is no refresh button to babysit.
- **Tunde and Grace** see their "Ready to withdraw" balance go up. They can withdraw whenever they like, in one transaction, even after 100 answers.
- **Musa** answered late. Nothing happens to him; he wasn't in the quorum.
- **What if Tunde had said "Yes" and Grace "No"?** No quorum. The contract **refunds Amina's 0.25 USDC**.
- **What if the Plumbline server went offline mid-way?** After a timeout, **anyone** can call `refund_timeout(9001)` on the contract and the money goes back to Amina. No admin, no permission, no support ticket. (`plumb refund 9001` does it for you.)

---

## 3. Who uses it

| You are… | You use… | You need… |
|---|---|---|
| **An asker** who wants answers | The **Ask** page, the API, or `plumb ask` | USDC in a Stellar wallet (no XLM), or an API key |
| **A verifier** who wants to earn | The **Verify & earn** page, or `plumb verifier` | Any wallet, or the built-in one. Optionally a bond. |
| **A developer** building on it | The HTTP API, the **ask widget**, `@plumbline/core` | An API key, or nothing for the sandbox |
| **An operator** running the service | The **Control room** and **Live wire** | The backend's admin token |

---

## 4. Run it in 3 minutes (no blockchain needed)

This repo includes a **mock backend**: a small in-memory server that behaves like the real one, minus the blockchain. It's ideal for trying the UI, building features and running demos.

**You need:** [Node.js 20+](https://nodejs.org) (`node -v` to check). That's all.

```bash
git clone <your-fork-url> plumbline
cd plumbline
npm install                 # installs all three packages (web, core, cli) at once

npm run dev:all             # starts the mock backend on :4000 AND the web app on :5173
```

Open **http://localhost:5173** and try this:

1. **Overview page** → type *"What is the capital of France?"* in the sandbox box → **Ask**. You get "Paris".
2. **Verify & earn** → **Use built-in wallet** → tick a topic → **Go online**.
3. In a second terminal, play the asker:
   ```bash
   npm run plumb -- sandbox "What is the capital of Nigeria?" --tier instant
   ```
   The question pops up on your Verify page with a countdown. Type *Abuja* → **Submit**. The terminal prints `ANSWERED — "Abuja"`. You just verified a question.
4. **Control room** → sign in with `dev-admin-token` to see transactions, verifiers, treasury and the trust histogram.

> `dev:all` also points the app's account checks at the mock (`VITE_HORIZON_URL=http://localhost:4000`), so everything works offline. The mock accepts any signature and never touches a blockchain. Use it for development only.

Prefer Docker? `docker compose up --build` starts the mock and two simulated verifiers. Then run `docker compose run --rm plumb sandbox "What is 6 x 7?"`.

---

## 5. Run it against a real backend on testnet

Plumbline's frontend speaks the same HTTP API and contract interface as the Arbiter backend and contract. Run [arbiter-backend](https://github.com/Arbiter-xyz/arbiter-backend) (or your own compatible fork) with a deployed escrow contract, then:

```bash
cp web/.env.example web/.env
cp cli/.env.example cli/.env
```

Fill in at least:

| Variable | Example | Meaning |
|---|---|---|
| `VITE_BACKEND_URL` / `BACKEND_URL` | `https://api.example.com` | Your backend |
| `VITE_ORACLE_CONTRACT_ID` / `ORACLE_CONTRACT_ID` | `CAB…XYZ` | The escrow contract address |
| `PAYER_SECRET` (CLI only) | `S…` | A **testnet** key with some test USDC, for `plumb ask` |

Get testnet keys and XLM from the [Stellar Laboratory](https://laboratory.stellar.org) friendbot. Never paste a mainnet secret into a `.env` file.

```bash
npm run dev                                   # web app against your backend
npm run plumb -- ask "Is 2^61-1 prime?" --sponsored
npm run plumb -- sponsored-proof              # proves the whole zero-XLM journey on testnet
```

To go to mainnet, set `VITE_NETWORK=public` (and `NETWORK=public` for the CLI). Network passphrase, Horizon, RPC and explorer links all follow from that one variable, and the CLI prints a warning on every mainnet run.

---

## 6. The web app, screen by screen

Everything is **one app with one wallet connection**. Connect once in the header and every screen uses it. You can connect several wallets and switch between them from the header.

| Route | Screen | What you can do |
|---|---|---|
| `/` | **Overview** | Sandbox try-it box (auto-picks a tier as you type), live stats ticker, tier comparison with live prices, live **surge chart**, comparison table, FAQ, embed snippets |
| `/verify` | **Verify & earn** | Back up / lock / split / restore the built-in wallet · one-click **sponsored setup** · pick topics with a **live demand meter** · go online (auto-reconnects) · answer with countdown, 400-char counter and **draft restore** · **practice mode** · push notifications + digest · **earnings & bond**: withdraw all or part, to yourself or another address, **cash out to a bank** (SEP-24), **stake** · referral link · personal **ledger book** with CSV export |
| `/ask` | **Ask** | **Compose and pay for a question in the browser** (locked quote → sign → zero-XLM fee-bump → watch it settle) · image attachments · live history shared across tabs · search, filter, ★ star · spend calendar · cancel within the undo window · 👍/👎 on answers · CSV/JSON export |
| `/standings` | **Standings** | Public ranking (sort by agreement, answers or bond; search) · live anonymised settlement feed |
| `/v/:address` | **Verifier profile** | Rank, agreement, answers, bond, explorer link, shareable URL |
| `/account` | **API account** | Buy a key by card · sign in with a key · credit balance and top-up · settlement **webhook** · test console · curl/JS snippets |
| `/health` | **Health** | Live up/degraded/down state, response-time bars, version compatibility |
| `/control` | **Control room** | Operator console: overview with low-balance alarms, transactions with filters, pagination and CSV, verifiers, askers, private pools (whitelist add/remove), fees & treasury, **trust histogram** with adjustable threshold, KYC/payout reports, network config, compact rows |
| `/live` | **Live wire** | Demo feed of dispatch → answer → settlement, pausable |

The app also has English and **Arabic** with a true right-to-left layout, **light/dark** themes, a **notification inbox** that remembers the last 60 events, toast messages, a one-time "what's new" dialog after upgrades, an offline app shell, and keyboard/screen-reader support (focus moves to new questions; progress bars are announced in steps).

Old Arbiter URLs (`/index.html`, `/dashboard.html`, `/worker.html?address=…`, and so on) redirect to the matching screen.

---

## 7. The `plumb` CLI

One tool replaces the seven separate demo scripts of the original. Run it with `npm run plumb -- <command>`. After `npm link -w cli`, plain `plumb <command>` works too.

```text
plumb sandbox "<question>" [--tier standard] [--json]     free, no wallet, no chain
plumb status                                               health, version, verifiers online
plumb ask "<question>" [--tier T] [--category C] [--image ./x.png] [--sponsored]
plumb refund <questionId>                                  permissionless refund_timeout()
plumb verifier [--answer 42] [--categories math,coding] [--id NAME] [--stake 1.5] [--auto-withdraw 30s]
plumb sponsored-proof [--timeout-refund]                   proves the zero-XLM journey on testnet
plumb scenario <quorum|disagreement|timeout-refund> [--workers 3]
plumb bot "<question>" [--user U123]                       rate-limited replies for Slack/Discord bots
```

**Examples:**

```bash
# A headless verifier that answers "42" to coding questions, stakes 2 USDC,
# and sweeps its earnings into one withdrawal every 10 minutes:
WORKER_SECRET=S... npm run plumb -- verifier --categories coding --answer 42 --stake 2 --auto-withdraw 10m

# Three in-process verifiers agree on "Paris" → you watch a quorum resolve:
npm run plumb -- scenario quorum --workers 3
```

The verifier reconnects by itself, with backoff, if the connection drops. It also runs its live stream on a separate connection pool, so a long-lived stream can never block its own answer requests. That was a real bug in the original, reproduced against a hosted proxy.

---

## 8. Embeds: ask box and status badge

`npm run build` also produces two dependency-free scripts in `web/dist/embed/`:

```html
<!-- Free sandbox ask box. Shadow-DOM isolated, so the host page's CSS can't break it -->
<div data-plumbline-ask data-api-base="https://api.example.com"></div>
<script type="module" src="https://app.example.com/embed/ask-widget.js"></script>

<!-- Honest status badge: shows "status unavailable", never a fake "operational" -->
<div data-plumbline-status data-api-base="https://api.example.com"></div>
<script type="module" src="https://app.example.com/embed/status-badge.js"></script>
```

Both scripts also pick up the original `data-arbiter-widget` / `#arbiter-status` containers.

---

## 9. How the code is organised

```
plumbline/
├── packages/core/        @plumbline/core: shared by web AND cli, no UI, fully unit-tested
│   └── src/  api.ts        typed client for every backend endpoint (timeouts, typed errors, retry)
│             money.ts      exact USDC ↔ stroop maths with bigint (never floats)
│             shamir.ts     k-of-n recovery shares with typo-catching checksums
│             sequence.ts   ordered live-event tracking + backoff
│             filters.ts    search/filter/histogram/calendar logic
│             csv.ts scrub.ts sse.ts version.ts hash.ts ratelimit.ts format.ts types.ts
├── web/                  the React single-page app
│   ├── src/lib/          session (one wallet session), wallet/ (extension + hardened built-in
│   │                     signer in a Web Worker), soroban.ts (contract calls), statusChannel.ts
│   │                     (one live stream shared by all tabs), anchor.ts (bank cash-out), i18n/,
│   │                     notify.ts, flags.ts, telemetry.ts, push.ts, growth.ts
│   ├── src/components/   Shell (header, wallet menu, inbox, toasts), ui kit, gates, wallet care
│   ├── src/routes/       Home · Verify · Ask · Standings · Profile · Health · Account · Control · LiveWire
│   ├── src/embed/        ask-widget + status-badge
│   └── public/sw.js      push notifications + offline shell
├── cli/                  the `plumb` tool (TypeScript, run via tsx, no build step)
├── infra/                mock backend, Dockerfiles, smoke test, bundle budget
└── docs/                 architecture, backend contract, security, migration notes, Drips Wave guide
```

**Why a shared core matters.** In the original, every page hand-wrote its own `fetch()` calls, and they had drifted apart: some read the server's error message and some crashed on a non-JSON reply. Now there is **one** typed client. Fix it once and the web app and the CLI both get the fix.

More in [`docs/architecture.md`](docs/architecture.md) and [`docs/backend-contract.md`](docs/backend-contract.md).

---

## 10. Configuration reference

**Web (`web/.env`).** All variables are optional except the backend and contract:

| Variable | Default | Notes |
|---|---|---|
| `VITE_BACKEND_URL` | `http://localhost:4000` | |
| `VITE_NETWORK` | `testnet` | `public` = mainnet. Drives the passphrase, Horizon, RPC and explorer links |
| `VITE_HORIZON_URL`, `VITE_SOROBAN_RPC_URL` | follow the network | Override, e.g. to point at the mock |
| `VITE_ORACLE_CONTRACT_ID` | — | Needed for stake, withdraw and paid asks |
| `VITE_USDC_ASSET_CODE` / `_ISSUER` | Circle testnet USDC | |
| `VITE_ENABLE_LEDGER` | `false` | Adds the Ledger hardware wallet. Its USB code isn't even resolved unless enabled |
| `VITE_SENTRY_DSN` | — | Opt-in error reports, scrubbed of keys, tokens and addresses. Honors Do-Not-Track |
| `VITE_UNLEASH_URL` / `_CLIENT_KEY` | — | Remote feature flags. Otherwise `public/flags.json` |

**Feature flags** (`web/public/flags.json`, change them without a rebuild): `pushNotifications`, `askComposer`, `practiceMode`, `socialRecovery`. Each can be `true`, `false`, or `{ "enabled": true, "rollout": 25 }` for a stable 25% of browsers.

**CLI (`cli/.env`):** see [`cli/.env.example`](cli/.env.example). The old Arbiter names (`DEMO_PAYER_SECRET`, etc.) still work.

---

## 11. Money and safety guarantees

| Guarantee | How |
|---|---|
| **No stuck funds** | Every question ends in `resolve()` or `refund()`. If the server vanishes, anyone can call `refund_timeout()` after the window |
| **Price can't move on you** | The quote is locked to your question id at step 1 |
| **Exact amounts** | All maths in `bigint` stroops (1 USDC = 10,000,000). `0.1 + 0.2` errors are impossible |
| **Built-in wallet key can't be stolen by page scripts** | It lives in a Web Worker. It's encrypted at rest until you back it up, then becomes a **non-extractable** WebCrypto key |
| **Backups you can split** | k-of-n Shamir shares made in your browser, each with a checksum that catches typos |
| **One signature, not ten** | Session sign-ins are de-duplicated and cached per tab |
| **No XSS through user content** | Question text, verifier ids and self-reported fields are only ever rendered as text. CSV exports neutralise spreadsheet formulas |
| **Honest status** | Health page, badge and live widgets hide numbers they can't verify instead of showing stale ones |

Full threat model: [`docs/security.md`](docs/security.md).

---

## 12. Testing and CI

```bash
npm test             # unit tests (core money, Shamir, CSV, scrubbing, filters, API client, SSE, CLI args)
npm run typecheck    # strict TypeScript across core, web and cli
npm run build        # production build + embeds
npm run smoke        # browser smoke test (needs `npm run mock` + `npm run preview -w web`)
npm run check        # typecheck + tests + build in one go
```

CI (`.github/workflows/ci.yml`) runs typecheck, tests, build and an **initial-load bundle budget**. The Stellar SDK and wallet adapters must stay lazy-loaded, so a visitor reading the landing page downloads about 72 KB gzipped. CI also runs the Playwright smoke test against the mock backend, which includes a complete "go online → receive question → answer → settled" flow.

---

## 13. Glossary

- **Stellar**: a payments blockchain with fast, very cheap transactions and native USDC.
- **Soroban**: Stellar's smart-contract platform. Plumbline's escrow runs on it.
- **USDC**: a token worth $1, issued by Circle.
- **Stroop**: the smallest unit, 0.0000001 of an asset.
- **XLM**: Stellar's native coin, normally needed for fees. Plumbline sponsors fees so you don't need any.
- **Trustline**: a one-time opt-in that lets an account hold a token like USDC. Plumbline sponsors it.
- **Escrow**: money held by a neutral party (here, a contract) until a condition is met.
- **Quorum**: the minimum number of verifiers who must agree.
- **Bond / stake**: a deposit a verifier can lose for answering against the quorum.
- **Fee-bump**: a Stellar feature where one account pays the fee for another's transaction.
- **SEP-10 / SEP-24**: Stellar standards for signing in to, and withdrawing through, a regulated "anchor" (a bank on/off-ramp).
- **SSE**: Server-Sent Events, a simple one-way live stream from the server to the browser.

---

## 14. FAQ and troubleshooting

**"Connect wallet" does nothing.** You may have no Stellar extension installed. Use **Use built-in wallet**, or install Freighter or xBull.

**The Verify page says I need setup, then setup fails.** Setup is sponsored by the backend's `/sponsor/onboard` endpoints. Check the backend is reachable on the **Health** page, and that the app's network matches the backend's (testnet vs public).

**Withdraw/Stake says "No escrow contract is configured".** Set `VITE_ORACLE_CONTRACT_ID` and rebuild.

**A banner says the server version is incompatible.** The app checks the backend's `/health` version with semver. A different *major* version is flagged; a newer minor/patch version is fine. The banner informs you and never blocks you.

**I cleared my browser and lost my built-in wallet.** Without a backup (the secret or enough recovery shares) it cannot be recovered. That is the price of being non-custodial. Use **Restore a built-in wallet** if you have the backup.

**Where's the backend / smart contract?** Not in this repo. Plumbline is the client side: the web app, SDK and CLI. It is compatible with the Arbiter backend and contract.

---

## 15. Contributing, credits and license

Contributions are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md). If you came here through **Drips Wave**, [`docs/drips-wave.md`](docs/drips-wave.md) explains how the program works and lists scoped starter issues.

**Credits.** Plumbline is a derivative of [**arbiter-app**](https://github.com/Arbiter-xyz/arbiter-app) by the Arbiter contributors (Apache-2.0). It talks to the Arbiter-defined backend API and Soroban contract interface. It was rewritten into a TypeScript monorepo with a new design, a unified app shell, many fixes and new features. The full list is in [`docs/migration-from-arbiter.md`](docs/migration-from-arbiter.md), and attribution is in [`NOTICE`](NOTICE).

**License.** [Apache License 2.0](LICENSE). Keep `LICENSE` and `NOTICE` with any redistribution.
#   p l u m b l i n e  
 