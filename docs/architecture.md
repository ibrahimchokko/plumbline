# Architecture

## The big picture

```
                 ┌──────────────────────── this repo ────────────────────────┐
  Browser        │  web/ (React SPA)                cli/ (plumb)              │
  ───────        │   ├─ routes/  screens            ├─ commands/             │
  extension ◀──▶ │   ├─ lib/session  ONE session    │   ask · verifier · …   │
  wallets        │   ├─ lib/wallet   kit + worker   └─ chain.ts (Keypair)    │
                 │   └─ lib/soroban  contract calls                           │
                 │              ▲                          ▲                  │
                 │              └──── packages/core ───────┘                  │
                 │                    typed API · money · shamir · sse · …     │
                 └───────────────────────────┬────────────────────────────────┘
                                             │ HTTP + SSE
                                ┌────────────▼────────────┐
                                │ backend (arbiter-backend │──── fee-bump relay ───┐
                                │   or infra/mock-backend) │                       │
                                └────────────┬────────────┘                       ▼
                                             │ resolve / refund        ┌─────────────────────┐
                                             └────────────────────────▶│ Soroban escrow       │
                                                                       │ contract (USDC)      │
                                Horizon (account/trustline reads) ◀────└─────────────────────┘
```

## Key decisions

### 1. One session for the whole app (`web/src/lib/session.tsx`)
- `SessionProvider` holds every connected wallet (`Signer[]`) and which one is active.
- `ensureSession()` signs the backend's challenge **once**. Concurrent callers share the in-flight promise, so ten components never trigger ten wallet prompts. The token is cached in `sessionStorage` until one minute before it expires.
- Remembered wallets are silently re-attached on reload. The built-in wallet always comes back; an extension wallet comes back if it doesn't need a new permission.

### 2. Two kinds of signer, one interface (`lib/wallet/`)
- **Extension**: Stellar Wallets Kit with an explicit module list (Freighter, Lobstr, xBull, Hana, Albedo, HOT). It's imported lazily on the first "Connect" click. Ledger is a build-time opt-in.
- **Built-in**: a Web Worker (`signer.worker.ts`) that owns the key in IndexedDB. The page only ever sees the address and signed XDR. See [`security.md`](security.md).

### 3. Live data without polling storms
- **Verifier dispatch**: one `EventSource` per verifier, reconnecting with exponential backoff. After repeated failures the session token is refreshed.
- **Asker history**: `statusChannel.ts` elects one leader tab per address (Web Locks). The leader holds the only SSE connection and fans events out to the other tabs over `BroadcastChannel`. `SequenceTracker` (core) drops duplicates and resyncs from a snapshot when it detects a gap.
- **Public**: `/activity` and `/pricing/surge/stream` streams. Gaps in the surge chart are drawn as gaps, never interpolated.

### 4. Lazy everything
Routes are `React.lazy` chunks. The Stellar SDK and wallet adapters are `import()`ed by the code that needs them, so the first visit downloads about 72 KB of gzipped JS. `infra/check-bundle.mjs` enforces this in CI.

### 5. One API client (`packages/core/src/api.ts`)
Timeouts, typed errors, a GET retry, credentials per scope (admin bearer / API key), and `onUnauthorized` hooks. Both the web app and the CLI import it, so a backend change is a one-file update.

### 6. One notification pipe (`lib/notify.ts`)
`notify(message, { tone, scope })` feeds toasts, the header inbox (persisted) and each screen's activity log (filtered by scope).

### 7. Feature flags (`lib/flags.ts`)
Runtime flags come from `/flags.json` or Unleash, with stable percentage rollouts (FNV-1a bucket per browser). Any failure falls back to the defaults.

## Request lifecycle: a verifier answering

1. `/verify` mounts → `accountReadiness()` reads Horizon → is there a trustline? If not, the onboarding panel appears.
2. **Go online** → `ensureSession()` (one signature) → `EventSource(/app/events?worker&token&categories)`.
3. `event: question` → `QuestionCard` (focus moves there, countdown, draft autosave).
4. Submit → `POST /app/answer`. A 409 means "too late". A 401 means re-sign once and retry. A network error means retry until the deadline.
5. `Earnings` polls owed / stake / reputation every 20 s (paused while the tab is hidden).

## Adding a screen

1. Create `web/src/routes/MyScreen.tsx` with a default export.
2. Add a `lazy()` import and a `<Route>` in `App.tsx`. Add it to `NAV` in `Shell.tsx` if it should appear in the header.
3. Use `useSession()` for the wallet, `api.*` for data, and `scoped('my-screen')` for activity messages.
4. Add strings to `lib/i18n/en.ts`. TypeScript then reports the missing key in `ar.ts` until it's translated.
