# Backend contract

Every HTTP call the web app and CLI make. All of them live in [`packages/core/src/api.ts`](../packages/core/src/api.ts). That file is the single source of truth.

**Status legend.**
- ✅ **Used**: the original Arbiter app already called this, so a compatible backend serves it.
- 🟡 **Assumed**: the original app *assumed* this endpoint, which may not exist yet. Plumbline maps 404/405/501 on these to a friendly "this server doesn't support that yet" message (`kind: 'not-deployed'`).

## Errors

Every failure is an `ApiError` with a `kind`:

| kind | When |
|---|---|
| `network` / `timeout` | Could not reach the server, or no answer within 15 s (GETs retry once) |
| `unauthorized` (401) | Bad session token, admin token or API key. Admin and API-key credentials are cleared automatically |
| `forbidden` (403) | Token is valid but its role can't see this |
| `conflict` (409) | e.g. answering a question that already closed |
| `payment-required` (402) | Expected only from the quote step |
| `not-deployed` | 404/405/501 on an 🟡 endpoint |
| `http` | Anything else. The message is the server's `{ "error": "…" }` if present |

## Public

| Method & path | Status | Returns |
|---|---|---|
| `GET /health` | ✅ | `{ apiVersion \| version }` (semver-checked against `web/package.json#compatibleBackendVersion`) |
| `GET /stats` | ✅ | `{ totalResolved, totalRefunded, onlineWorkers }` |
| `GET /oracle/tiers` | ✅ | `TierInfo[]` or `{ tiers }` |
| `GET /price` | 🟡 | `{ [tier]: price }` or `{ prices }` |
| `GET /leaderboard` | ✅ | `{ leaderboard: LeaderboardRow[] }` |
| `GET /categories/demand` | ✅ | `{ demand: { [category]: onlineCount } }` |
| `GET /activity` (SSE) | ✅ | `event: settlement`, `{ category, tier, outcome, amount }` (no identities) |
| `GET /pricing/surge/stream` (SSE) | ✅ | `data: { surgeMultiplier, at? }` |

## Asking (the 402 flow)

```
POST /oracle {question, tier?, category?, attachmentId?}
  → 402 {questionId, amount, amountStroops, surgeMultiplier?}      price locked to questionId
(client signs contract.submit(payer, questionId, amountStroops))
POST /sponsor/pay {xdr, payerAddress, questionId}  → {hash}          fee-bumped: zero XLM
POST /oracle {question}  + headers X-Payment-Tx: <hash>, X-Question-Id: <id>
  → 202 {jobId, statusUrl}
GET /oracle/:jobId  → Job {status, outcome?, answer?, confidence?, payoutTx?, refundTx?, reason?, totalAnswers?}
```

| Path | Status |
|---|---|
| `POST /oracle` (quote / fulfil) | ✅ |
| `POST /oracle` with `X-Api-Key` → 202 | 🟡 |
| `POST /oracle/sandbox {question, tier?}` → 202 | ✅ |
| `GET /oracle/:jobId` | ✅ |
| `POST /attachments` (multipart `image`) → `{attachmentId, url}` | 🟡 |

## Verifiers (`/workers`)

| Method & path | Status | Notes |
|---|---|---|
| `POST /workers/:a/session/challenge` → `{xdr}` | ✅ | The wallet signs it; it is never submitted |
| `POST /workers/:a/session {signedXdr}` → `{token, expiresAt}` | ✅ | Bearer for everything below |
| `GET /app/events?worker&token&categories` (SSE) | ✅ | `event: connected`, `event: question {questionId, question, expiresInMs, category?, tier?, attachmentUrl?}` |
| `POST /app/answer {questionId, workerId, answer, token}` | ✅ | 409 = closed / expired / already answered |
| `GET /workers/:a/owed` → `{owed, owedStroops}` | ✅ | |
| `GET /workers/:a/stake` → `{stake}` | ✅ | |
| `GET /workers/:a/reputation` → `{matched, total, matchRatio}` | ✅ | |
| `GET /push/vapid-public-key` → `{publicKey}` | ✅ | |
| `POST /workers/:a/push-subscribe {subscription, categories, token}` | ✅ | |
| `POST /workers/:a/digest {token, digest}` | 🟡 | instant / daily / weekly |
| `POST /workers/:a/referral` (Bearer) → `{code}` | 🟡 | |
| `GET /workers/:a/referral/stats` (Bearer) → `{referred, established}` | 🟡 | |

## Sponsored relay (zero XLM)

| Path | Body | Status |
|---|---|---|
| `POST /sponsor/onboard/build` | `{address, referralCode?}` → `{xdr}` | ✅ |
| `POST /sponsor/onboard/submit` | `{xdr}` → `{hash}` | ✅ |
| `POST /sponsor/stake` | `{xdr, workerAddress, amountStroops, token?}` → `{hash}` | ✅ |
| `POST /sponsor/withdraw` | `{xdr, workerAddress, amountStroops, beneficiaryAddress?, token?}` → `{hash}` | ✅ |
| `POST /sponsor/pay` | `{xdr, payerAddress, questionId}` → `{hash}` | ✅ |

## Askers (`/payers`)

| Path | Status |
|---|---|
| `GET /payers/:a/questions?token` → `{questions, totalSpend, totalTracked, successRate, cursor}` | ✅ |
| `GET /payers/:a/questions/stream?token&since` (SSE `event: status`, `id: <seq>`) | ✅ |
| `POST /payers/:a/questions/:id/cancel {token}` | 🟡 |
| `POST /payers/:a/questions/:id/feedback?token {rating}` | 🟡 |

## Bank cash-out

| Path | Status |
|---|---|
| `GET /anchor/config` → `{webAuthEndpoint, transferServerSep24}` (503 = none) | ✅ |
| `POST /anchor/report` (best-effort cache for the control room) | ✅ |

The SEP-10 and SEP-24 calls go **directly** from the browser to the anchor.

## Control room (`Authorization: Bearer <ADMIN_TOKEN>`)

`GET /admin/transactions?limit&offset` · `/admin/workers` · `/admin/payers` · `/admin/fees` · `/admin/treasury` ✅
`GET /admin/kyc` · `/admin/payouts` · `/admin/worker-pools` · `POST|DELETE /admin/worker-pools/:id/whitelist[/:address]` 🟡

## API-key customers (`X-Api-Key`)

`GET /billing/account` · `POST /billing/checkout` ✅/🟡 · `GET|POST|DELETE /billing/account/webhook` 🟡

## Contract methods (Soroban)

| Method | Who signs | Used by |
|---|---|---|
| `submit(payer, question_id: u64, amount: i128)` | asker | Ask page, `plumb ask` |
| `stake(worker, amount: i128)` | verifier | Earnings, `plumb verifier --stake` |
| `withdraw(worker, amount: i128)` | verifier | Earnings, auto-withdraw |
| `withdraw_to(worker, beneficiary, amount: i128)` (+ memo) | verifier | Payout to another address / bank |
| `refund_timeout(question_id: u64)` | **anyone** (fee only) | `plumb refund`, scenarios |
| `resolve` / `refund` | platform | backend only |
