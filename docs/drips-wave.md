# Plumbline and Drips Wave (Stellar)

This guide explains what Drips Wave is, how a repository like this one takes part, and lists scoped starter issues ready to label.

> Researched October 2026 from Drips' own docs and blog plus one third-party guide. Program rules and pool sizes change from wave to wave, so check [docs.drips.network/wave](https://docs.drips.network/wave) before relying on any number below.

## What Drips Wave is

Drips Wave is a recurring bounty cycle, tagline **"Fix, Merge, and Earn"**. Each wave usually runs for **one week**, roughly monthly. The **Stellar Development Foundation (SDF)** funds the Stellar program to grow open-source work across the Soroban ecosystem. The first full wave, **Stellar Wave 1**, launched in **January 2026**, and Drips reported three completed Stellar waves by the end of Q1 2026.

**The three phases of a wave:**
1. **Scoping.** Maintainers apply their repos to a Wave Program. *Program organizers must approve each repo.* Maintainers then add issues and give each a complexity rating.
2. **Sprint.** Contributors sign in with GitHub, apply for issues, get assigned by the maintainer, and open PRs.
3. **Reward.** Resolved issues earn **Points**. When the wave ends, a fixed **reward pool** is split by each contributor's share of all Points.

**Points per issue:** Trivial **100**, Medium **150**, High **200**.

**Contributor rules (current docs):** at most **15 pending applications** at once, at most **4 assigned issues per organisation per wave**, and no coding before you're assigned. Reviews go both ways within **14 days** of an issue closing. **KYC** is required to claim rewards, which are paid in USDC on Stellar. Since Wave 6 (live 23 June 2026), repo applications are capped at **5 per wave per user/org**, and applying requires KYC.

**Scale, per a third-party guide (May 2026, unverified by Drips):** about 533 approved Stellar repos, recent pools of $60K–$75K per cycle, about $255K paid across four waves from January to April 2026, and roughly 782 contributors in a recent wave.

## How this repo would participate (maintainer checklist)

1. **Make the repo public** under your GitHub org and install the **Drips Wave GitHub App** on it. The app is how Drips tracks issues and labels.
2. In the Drips app, go to **Maintainers → Orgs and Repos** → sync the repo → **apply it to the Stellar Wave program**. Wait for organizer approval (you get an email and an in-app notice).
3. **Before the wave:** spend 1–2 hours scoping good first issues. Add them via **Maintainers → Issues → Add to Wave**, or with the program's GitHub label (label-added issues start at *Trivial*; raise them in the app).
4. **During the wave (one week):** check the dashboard daily, review applications and assign people.
5. **After the wave:** review and merge before the deadline, mark issues **Resolved**, and leave reviews. Drips calculates and pays out; you never handle funds.

**On approval and originality.** Organizers approve repos by hand, and reviewers can see a repo's history and upstream. Plumbline is an openly credited derivative of arbiter-app (see `NOTICE`), so present it that way. Put the value of *this* repo up front: the TypeScript rewrite, the unified app, the shared SDK, the CLI, the mock backend and tests. Don't present it as unrelated to Arbiter. Arbiter's own repos may already be in the program, so coordinate rather than compete for the same issues.

## Starter issues, ready to label

| # | Title | Complexity | Points |
|---|---|---|---|
| 1 | Add French (fr) and Hausa (ha) translations to `web/src/lib/i18n` | Trivial | 100 |
| 2 | Show a QR code for the verifier profile URL on `/v/:address` | Trivial | 100 |
| 3 | Add `--json` output to `plumb status` and `plumb ask` | Trivial | 100 |
| 4 | Keyboard shortcut: <kbd>Enter</kbd> on the Verify page focuses the answer box | Trivial | 100 |
| 5 | Unit tests for `statusChannel` gap / resync using a fake EventSource | Medium | 150 |
| 6 | Persist Standings sort/search in the URL query string | Medium | 150 |
| 7 | Mock backend: simulate surge from real queue depth and add `/sponsor/*` stubs | Medium | 150 |
| 8 | Control room: CSV export for KYC and payouts with date filters | Medium | 150 |
| 9 | Verifier "streak" and accuracy-over-time sparkline on the profile page | Medium | 150 |
| 10 | Offline answer outbox: queue answers in IndexedDB and flush on reconnect before the deadline | High | 200 |
| 11 | Playwright visual-regression suite for every route (light, dark, RTL) | High | 200 |
| 12 | Publish `@plumbline/core` to npm with build, types and a changelog | High | 200 |

Each issue should say what "done" means, which files to touch, and how to test it. `CONTRIBUTING.md` has the template.

## Sources

- [Drips Wave — docs](https://docs.drips.network/wave)
- [Participating in a Wave (maintainers)](https://docs.drips.network/wave/maintainers/participating-in-a-wave)
- [Maintainer FAQ](https://docs.drips.network/wave/maintainers/faq)
- [Solving issues and earning rewards (contributors)](https://docs.drips.network/wave/contributors/solving-issues-and-earning-rewards)
- [Drips Wave details (blog)](https://www.drips.network/blog/posts/wave-details-blog)
- [Drips Wave: what's launching in January](https://www.drips.network/blog/posts/drips-wave-whats-launching-in-january)
- [Q1 2026 roundup](https://www.drips.network/blog/posts/q1-2026-roundup)
- [What's new in Stellar Wave 6 (Lumen Loop)](https://lumenloop.com/news/changelog-new-stellar-wave-6)
- [Drips Wave earning guide (gigs.sh, third-party)](https://gigs.sh/p/drips-wave)
- [Stellar Wave program page](https://www.drips.network/wave/stellar)
