# Security model

## Built-in wallet (non-custodial)

**What it is.** A Stellar keypair created in the visitor's browser. Plumbline's servers never see the secret. The trust model is the same as an extension wallet's, without hardware backing.

**Where the key lives.** Only inside a dedicated Web Worker (`web/src/lib/wallet/signer.worker.ts`), persisted in IndexedDB:

| State | Stored as | Who can read the secret |
|---|---|---|
| `pending-backup` | AES-GCM ciphertext + a **non-extractable** AES key | Only the worker (for reveal / split during backup) |
| `locked` | A **non-extractable** WebCrypto Ed25519 signing key | **Nobody**, not even the worker. It can only produce signatures |
| `locked-fallback` | Ciphertext (browser lacks WebCrypto Ed25519) | Only the worker. Exports are refused |

**What an attacker with XSS on this origin could do.** While the page is open, it could ask the worker to sign a transaction. That is the same power an extension wallet's page bridge exposes. It **cannot** read the key once it is `locked`. Copying the IndexedDB files to another machine doesn't help either, because the wrapping key is non-extractable.

**Backups.** The user can reveal and copy the key (optionally behind a passkey / fingerprint check), or split it into k-of-n **Shamir shares** in the browser. Each share is `pl1-k-n-x-<hex>-<checksum>`. The FNV checksum catches typos at restore time. Shares need a cryptographic RNG; there is deliberately no `Math.random()` fallback. Fewer than k shares reveal nothing about the key.

**Migration.** A legacy plaintext Arbiter secret in `localStorage` is moved into the worker and **deleted** from `localStorage` on first open.

## Sessions

The backend issues a bearer token after the wallet signs a challenge transaction. That transaction is never submitted. Plumbline signs with `signTransaction`, never `signMessage`, because message conventions differ between wallets. Tokens are per tab (`sessionStorage`) and refreshed a minute before expiry.

## Untrusted content

Question text, answers, verifier ids (free-form for test ids), and self-reported KYC/payout fields are attacker-reachable.

- React renders them as **text**. The only markup ever created from them is the `SafeText` code-fence renderer, which builds its own `<pre>` / `<span>` nodes around plain text.
- Attachment images are shown only if they are served from the configured backend's origin.
- The settlement feed drops any event that carries `workerId` or `payer`, even if the backend regresses and sends them.
- **CSV exports** prefix cells starting with `= + - @ TAB CR` with `'` to block spreadsheet formula injection, and they include a UTF-8 BOM.

## Operator credentials

The admin bearer token and the customer API key are stored in `localStorage` under `plumbline.*` keys. Any 401 clears them, and there is an explicit **Sign out**. The input fields are `type=password` and marked `data-sensitive`.

## Telemetry

Off unless `VITE_SENTRY_DSN` is set. Do-Not-Track and Global Privacy Control turn it off too. Before sending, it:

- removes request headers, cookies, bodies and user info;
- redacts Stellar keys, bearer tokens, JWTs, recovery shares and 64-hex strings;
- blanks any object key that looks sensitive;
- drops breadcrumbs from inputs and sensitive elements.

## Money

- Exact `bigint` stroop maths in `@plumbline/core/money`.
- Payout addresses are validated with the full StrKey checksum before signing.
- Bank cash-out sends funds to the anchor only after an explicit confirmation, and only when the anchor returned a well-formed account and amount. Otherwise it shows manual instructions.
- `refund_timeout()` is permissionless, so escrow can be delayed but never stranded.

## Reporting a vulnerability

Please don't open a public issue. Email the maintainers (see `CONTRIBUTING.md`) with steps to reproduce.
