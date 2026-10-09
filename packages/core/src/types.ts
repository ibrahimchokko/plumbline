/**
 * Shapes of everything the backend sends and receives.
 *
 * These are derived from what the original Arbiter frontend actually read
 * and wrote. Fields marked "assumed" were already assumed by the original
 * code (the backend for them may not exist yet) — see
 * docs/backend-contract.md for the full list and status of each endpoint.
 */

export type TierId = 'instant' | 'standard' | 'express' | 'priority' | (string & {});
export type JobStatus = 'pending' | 'awaiting_workers' | 'reconciling' | 'settled' | (string & {});
export type Outcome = 'resolved' | 'refunded' | 'unsettled' | (string & {});

/* ---------- health / public stats ---------- */

export interface Health {
  ok?: boolean;
  apiVersion?: string;
  version?: string;
}

export interface PublicStats {
  totalResolved: number;
  totalRefunded: number;
  onlineWorkers: number;
}

export interface TierInfo {
  id: TierId;
  label?: string;
  price: number;
  quorumSize?: number;
  timeoutSeconds?: number;
}

/* ---------- oracle (ask) ---------- */

export interface AskRequest {
  question: string;
  tier?: TierId;
  category?: string;
  attachmentId?: string;
}

/** 402 Payment Required body: the price quote, locked for this questionId. */
export interface PaymentChallenge {
  questionId: string;
  amount: string;
  amountStroops: string;
  surgeMultiplier?: number;
  tier?: TierId;
  expiresAt?: number;
}

/** 202 Accepted body after payment proof is supplied. */
export interface JobAccepted {
  jobId: string;
  statusUrl?: string;
}

export interface Job {
  jobId?: string;
  status: JobStatus;
  outcome?: Outcome;
  answer?: string;
  confidence?: number;
  reconciliationMethod?: string;
  matchingWorkers?: string[];
  totalAnswers?: number;
  payoutTx?: string;
  refundTx?: string;
  reason?: string;
  autoRefundAfterLedgers?: number;
}

/* ---------- workers ("verifiers" in the UI) ---------- */

export interface Reputation {
  matched: number;
  total?: number;
  totalAnswers?: number;
  matchRatio: number | null;
}

export interface OwedBalance {
  owed: string;
  owedStroops: string;
}

export interface StakeBalance {
  stake: string;
  stakeStroops?: string;
}

export interface Session {
  token: string;
  expiresAt: number;
}

export interface DispatchedQuestion {
  questionId: string;
  question: string;
  expiresInMs: number;
  category?: string;
  tier?: TierId;
  attachmentUrl?: string;
}

export interface LeaderboardRow {
  workerId: string;
  matched: number;
  totalAnswers: number;
  matchRatio: number | null;
  stake: string;
}

export interface SettlementEvent {
  category: string;
  tier: TierId;
  outcome: Outcome;
  amount: string;
}

export type CategoryDemand = Record<string, number>;

/* ---------- payers ("askers" in the UI) ---------- */

export interface PayerQuestion {
  questionId: string;
  question?: string;
  tier?: TierId;
  amount?: string;
  status: JobStatus;
  outcome?: Outcome;
  confidence?: number;
  answer?: string;
  createdAt?: string | number;
  /** epoch ms — assumed (issue #32 in the original) */
  cancelableUntil?: number;
  feedback?: 'up' | 'down' | null;
}

export interface PayerSnapshot {
  questions: PayerQuestion[];
  totalSpend: string | number;
  totalTracked: number;
  successRate: number | null;
  cursor?: number;
}

/* ---------- sponsor relay ---------- */

export interface TxXdr {
  xdr: string;
}
export interface TxHash {
  hash: string;
}

/* ---------- anchor (SEP-10 / SEP-24) ---------- */

export interface AnchorConfig {
  webAuthEndpoint: string;
  transferServerSep24: string;
  homeDomain?: string;
}

/* ---------- admin ("control room") ---------- */

export interface AdminTransaction {
  questionId: string;
  payer?: string;
  amountStroops?: string;
  status?: JobStatus;
  outcome?: Outcome;
  createdAt?: string | number;
}

export interface AdminWorker {
  workerId: string;
  matchRatio: number | null;
  totalAnswers: number;
  established: boolean;
  stake: string;
  owed: string;
}

export interface AdminPayer {
  payerAddress: string;
  totalSpend: string;
  totalTracked: number;
  settled: number;
  successRate: number | null;
}

export interface AdminFees {
  resolvedCount: number;
  totalFeeRevenue: string;
}

export interface AdminTreasury {
  configured: boolean;
  platformAddress?: string;
  usdcBalance?: string;
  xlmBalance?: string;
  fiatPool?: { address: string; usdcBalance: string } | null;
}

export interface AdminKycRow {
  address: string;
  status?: string;
  tier?: string;
  reportedAt: string | number;
}

export interface AdminPayoutRow {
  address: string;
  amount?: string;
  assetCode?: string;
  status?: string;
  reportedAt: string | number;
}

export interface WorkerPool {
  id: string;
  name?: string;
  whitelist: string[];
}

/* ---------- API-key customers ---------- */

export interface CustomerAccount {
  accountId: string;
  creditBalance: string;
  creditBalanceStroops: string;
}
