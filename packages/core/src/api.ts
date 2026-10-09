/**
 * One typed client for the whole backend HTTP surface, shared by the web
 * app and the CLI.
 *
 * In the original codebase every page hand-rolled its own `fetch()` calls
 * with slightly different error handling (some read `.error` from the JSON
 * body, some didn't; some crashed on a non-JSON 500). Now every request:
 *   - has a timeout (no request can hang the UI forever),
 *   - throws a single `ApiError` type with a machine-readable `kind`,
 *   - retries idempotent GETs once on a network blip,
 *   - treats 404/405/501 on "assumed" endpoints as `not-deployed`, so the
 *     UI can say "this server doesn't support that yet" instead of failing.
 */

import type {
  AdminFees,
  AdminKycRow,
  AdminPayer,
  AdminPayoutRow,
  AdminTransaction,
  AdminTreasury,
  AdminWorker,
  AnchorConfig,
  AskRequest,
  CategoryDemand,
  CustomerAccount,
  Health,
  Job,
  JobAccepted,
  LeaderboardRow,
  OwedBalance,
  PayerSnapshot,
  PaymentChallenge,
  PublicStats,
  Reputation,
  Session,
  StakeBalance,
  TierInfo,
  TxHash,
  TxXdr,
  WorkerPool,
} from './types.ts';

export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'unauthorized' | 'forbidden' | 'conflict' | 'not-deployed' | 'payment-required';

export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    message: string,
    readonly kind: ApiErrorKind,
    readonly status = 0,
    readonly body: unknown = null,
  ) {
    super(message);
  }
}

export const isApiError = (e: unknown, kind?: ApiErrorKind): e is ApiError =>
  e instanceof ApiError && (kind === undefined || e.kind === kind);

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiOptions {
  baseUrl: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Bearer token for /admin/* routes. */
  adminToken?: () => string | null;
  /** X-Api-Key for API-key customers. */
  apiKey?: () => string | null;
  onUnauthorized?: (scope: 'admin' | 'customer' | 'session') => void;
}

interface RequestOpts {
  method?: string;
  body?: unknown;
  form?: FormData | URLSearchParams;
  headers?: Record<string, string>;
  query?: Record<string, string | number | undefined | null>;
  /** Which credential to attach. */
  auth?: 'admin' | 'customer';
  /** Status codes that are an expected, successful answer. */
  expect?: number[];
  /** Map 404/405/501 to kind='not-deployed'. */
  optional?: boolean;
  signal?: AbortSignal;
}

const enc = encodeURIComponent;

export function createApi(options: ApiOptions) {
  const base = options.baseUrl.replace(/\/+$/, '');
  const doFetch: FetchLike = options.fetch ?? ((i, init) => globalThis.fetch(i, init));
  const timeoutMs = options.timeoutMs ?? 15_000;

  function url(path: string, query?: RequestOpts['query']) {
    const u = `${base}${path}`;
    if (!query) return u;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    const s = qs.toString();
    return s ? `${u}?${s}` : u;
  }

  async function raw(path: string, o: RequestOpts = {}): Promise<Response> {
    const method = o.method ?? (o.body !== undefined || o.form ? 'POST' : 'GET');
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    let body: BodyInit | undefined;
    if (o.form) body = o.form;
    else if (o.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(o.body);
    }
    if (o.auth === 'admin') {
      const t = options.adminToken?.();
      if (t) headers.Authorization = `Bearer ${t}`;
    } else if (o.auth === 'customer') {
      const k = options.apiKey?.();
      if (k) headers['X-Api-Key'] = k;
    }

    const attempt = async (): Promise<Response> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
      const onOuterAbort = () => ctrl.abort(o.signal?.reason);
      o.signal?.addEventListener('abort', onOuterAbort, { once: true });
      try {
        return await doFetch(url(path, o.query), { method, headers, body, signal: ctrl.signal });
      } catch (err) {
        if (o.signal?.aborted) throw err;
        const timedOut = ctrl.signal.aborted;
        throw new ApiError(
          timedOut ? `The server did not answer within ${Math.round(timeoutMs / 1000)}s` : `Could not reach the server (${(err as Error)?.message ?? 'network error'})`,
          timedOut ? 'timeout' : 'network',
        );
      } finally {
        clearTimeout(timer);
        o.signal?.removeEventListener('abort', onOuterAbort);
      }
    };

    try {
      return await attempt();
    } catch (err) {
      // One quiet retry for idempotent reads on a transient network failure.
      if (method === 'GET' && isApiError(err, 'network')) return attempt();
      throw err;
    }
  }

  async function readBody(res: Response): Promise<unknown> {
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async function request<T>(path: string, o: RequestOpts = {}): Promise<T> {
    const res = await raw(path, o);
    const body = await readBody(res);
    const expected = o.expect ?? [];
    if (res.ok || expected.includes(res.status)) return body as T;

    const serverMsg =
      body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : typeof body === 'string' && body.length < 200 ? body : '';
    const msg = serverMsg || `Server returned HTTP ${res.status}`;

    if (res.status === 401) {
      options.onUnauthorized?.(o.auth === 'admin' ? 'admin' : o.auth === 'customer' ? 'customer' : 'session');
      throw new ApiError(msg, 'unauthorized', 401, body);
    }
    if (res.status === 403) throw new ApiError(msg, 'forbidden', 403, body);
    if (res.status === 409) throw new ApiError(msg, 'conflict', 409, body);
    if (res.status === 402) throw new ApiError(msg, 'payment-required', 402, body);
    if (o.optional && [404, 405, 501].includes(res.status)) {
      throw new ApiError('This server does not support this feature yet.', 'not-deployed', res.status, body);
    }
    throw new ApiError(msg, 'http', res.status, body);
  }

  const get = <T>(path: string, o: Omit<RequestOpts, 'method'> = {}) => request<T>(path, { ...o, method: 'GET' });
  const post = <T>(path: string, body?: unknown, o: Omit<RequestOpts, 'method' | 'body'> = {}) =>
    request<T>(path, { ...o, method: 'POST', body: body === undefined && !o.form ? {} : body });

  return {
    baseUrl: base,
    request,

    /* ---- public ---- */
    health: () => get<Health>('/health'),
    stats: (signal?: AbortSignal) => get<PublicStats>('/stats', { signal }),
    tiers: async () => {
      const body = await get<TierInfo[] | { tiers: TierInfo[] }>('/oracle/tiers');
      const list = Array.isArray(body) ? body : body?.tiers ?? [];
      return list.map((t) => ({ ...t, id: t.id ?? (t as { tier?: string }).tier ?? (t as { name?: string }).name ?? 'standard' }));
    },
    prices: () => get<Record<string, number> | { prices: Record<string, number> }>('/price', { optional: true }),
    leaderboard: async () => (await get<{ leaderboard: LeaderboardRow[] }>('/leaderboard')).leaderboard ?? [],
    categoryDemand: async () => (await get<{ demand: CategoryDemand }>('/categories/demand')).demand ?? {},

    /* ---- oracle ---- */
    oracle: {
      /** Step 1 of the paid flow: the server answers 402 with a locked quote. */
      quote: async (req: AskRequest): Promise<PaymentChallenge> => {
        const res = await raw('/oracle', { method: 'POST', body: req });
        const body = (await readBody(res)) as PaymentChallenge & { error?: string };
        if (res.status !== 402) throw new ApiError(body?.error ?? `Expected a 402 price quote, got HTTP ${res.status}`, 'http', res.status, body);
        return body;
      },
      /** Step 3: retry with proof of the on-chain payment -> 202 + jobId. */
      fulfil: (req: Partial<AskRequest>, proof: { paymentTx: string; questionId: string }) =>
        post<JobAccepted>('/oracle', req, { headers: { 'X-Payment-Tx': proof.paymentTx, 'X-Question-Id': proof.questionId }, expect: [202] }),
      /** API-key customers: billed from credit, no on-chain step (assumed). */
      askWithApiKey: (req: AskRequest) => post<JobAccepted>('/oracle', req, { auth: 'customer', expect: [202] }),
      sandbox: (question: string, tier?: string) => post<JobAccepted>('/oracle/sandbox', { question, ...(tier ? { tier } : {}) }),
      job: (jobId: string, signal?: AbortSignal) => get<Job>(`/oracle/${enc(jobId)}`, { signal }),
    },

    attachments: {
      upload: (file: Blob, filename = 'image') => {
        const form = new FormData();
        form.append('image', file, filename);
        return request<{ attachmentId: string; url: string }>('/attachments', { method: 'POST', form, optional: true });
      },
    },

    /* ---- verifiers (backend: /workers) ---- */
    workers: {
      challenge: (address: string) => post<TxXdr>(`/workers/${address}/session/challenge`),
      session: (address: string, signedXdr: string) => post<Session>(`/workers/${address}/session`, { signedXdr }),
      owed: (address: string) => get<OwedBalance>(`/workers/${address}/owed`),
      stake: (address: string) => get<StakeBalance>(`/workers/${address}/stake`),
      reputation: (address: string) => get<Reputation>(`/workers/${enc(address)}/reputation`),
      answer: (body: { questionId: string; workerId: string; answer: string; token?: string | null }) => post<unknown>('/app/answer', body),
      pushSubscribe: (address: string, body: { subscription: unknown; categories: string[]; token: string }) =>
        post<unknown>(`/workers/${address}/push-subscribe`, body),
      setDigest: (address: string, token: string, digest: 'instant' | 'daily' | 'weekly') =>
        post<unknown>(`/workers/${address}/digest`, { token, digest }, { optional: true }),
      createReferral: (address: string, token: string) =>
        post<{ code: string }>(`/workers/${address}/referral`, undefined, { headers: { Authorization: `Bearer ${token}` }, optional: true }),
      referralStats: (address: string, token: string) =>
        get<{ referred: number; established: number }>(`/workers/${address}/referral/stats`, { headers: { Authorization: `Bearer ${token}` }, optional: true }),
    },
    vapidKey: async () => (await get<{ publicKey: string }>('/push/vapid-public-key', { optional: true })).publicKey,

    /* ---- sponsored (zero-XLM) relay ---- */
    sponsor: {
      onboardBuild: (address: string, referralCode?: string | null) =>
        post<TxXdr>('/sponsor/onboard/build', { address, ...(referralCode ? { referralCode } : {}) }),
      onboardSubmit: (xdr: string) => post<TxHash>('/sponsor/onboard/submit', { xdr }),
      stake: (body: { xdr: string; workerAddress: string; amountStroops: string; token?: string }) => post<TxHash>('/sponsor/stake', body),
      withdraw: (body: { xdr: string; workerAddress: string; amountStroops: string; beneficiaryAddress?: string; token?: string }) =>
        post<TxHash>('/sponsor/withdraw', body),
      pay: (body: { xdr: string; payerAddress: string; questionId: string }) => post<TxHash>('/sponsor/pay', body),
    },

    /* ---- askers (backend: /payers) ---- */
    payers: {
      snapshot: (address: string, token: string) => get<PayerSnapshot>(`/payers/${address}/questions`, { query: { token } }),
      cancel: (address: string, questionId: string, token: string) =>
        post<unknown>(`/payers/${address}/questions/${enc(questionId)}/cancel`, { token }, { optional: true }),
      feedback: (address: string, questionId: string, token: string, rating: 'up' | 'down') =>
        post<unknown>(`/payers/${address}/questions/${enc(questionId)}/feedback`, { rating }, { query: { token }, optional: true }),
    },

    /* ---- fiat anchor ---- */
    anchor: {
      config: async (): Promise<AnchorConfig | null> => {
        try {
          return await get<AnchorConfig>('/anchor/config');
        } catch (err) {
          if (isApiError(err) && (err.status === 503 || err.status === 404)) return null;
          throw err;
        }
      },
      report: (body: Record<string, unknown>) => post<unknown>('/anchor/report', body).catch(() => null),
    },

    /* ---- control room ---- */
    admin: {
      transactions: (limit: number, offset: number) =>
        get<{ transactions: AdminTransaction[] }>('/admin/transactions', { auth: 'admin', query: { limit, offset } }).then((r) => r.transactions ?? []),
      workers: () => get<{ workers: AdminWorker[] }>('/admin/workers', { auth: 'admin' }).then((r) => r.workers ?? []),
      payers: () => get<{ payers: AdminPayer[] }>('/admin/payers', { auth: 'admin' }).then((r) => r.payers ?? []),
      fees: () => get<AdminFees>('/admin/fees', { auth: 'admin' }),
      treasury: () => get<AdminTreasury>('/admin/treasury', { auth: 'admin' }),
      kyc: () => get<{ customers: AdminKycRow[] }>('/admin/kyc', { auth: 'admin', optional: true }).then((r) => r.customers ?? []),
      payouts: () => get<{ payouts: AdminPayoutRow[] }>('/admin/payouts', { auth: 'admin', optional: true }).then((r) => r.payouts ?? []),
      pools: () => get<{ pools: WorkerPool[] }>('/admin/worker-pools', { auth: 'admin', optional: true }).then((r) => r.pools ?? []),
      addToPool: (poolId: string, address: string) =>
        post<{ whitelist: string[] }>(`/admin/worker-pools/${enc(poolId)}/whitelist`, { address }, { auth: 'admin' }).then((r) => r.whitelist),
      removeFromPool: (poolId: string, address: string) =>
        request<{ whitelist: string[] }>(`/admin/worker-pools/${enc(poolId)}/whitelist/${enc(address)}`, { method: 'DELETE', auth: 'admin' }).then((r) => r.whitelist),
    },

    /* ---- API-key customers ---- */
    customer: {
      account: () => get<CustomerAccount>('/billing/account', { auth: 'customer' }),
      checkout: (body?: { email?: string; amount?: number }) => post<{ url: string }>('/billing/checkout', body ?? {}, { auth: 'customer' }),
      webhook: () => get<{ url: string | null }>('/billing/account/webhook', { auth: 'customer', optional: true }),
      saveWebhook: (url: string) => post<{ url: string }>('/billing/account/webhook', { url }, { auth: 'customer', optional: true }),
      deleteWebhook: () => request<unknown>('/billing/account/webhook', { method: 'DELETE', auth: 'customer', optional: true }),
    },

    /* ---- streaming endpoints (opened with EventSource / fetch by the caller) ---- */
    streams: {
      dispatch: (worker: string, token?: string | null, categories: string[] = []) =>
        url('/app/events', { worker, token: token ?? undefined, categories: categories.length ? categories.join(',') : undefined }),
      payerStatus: (address: string, token: string, since: number) => url(`/payers/${address}/questions/stream`, { token, since }),
      activity: () => url('/activity'),
      surge: () => url('/pricing/surge/stream'),
    },
  };
}

export type Api = ReturnType<typeof createApi>;

/** Polls a job until it settles. Abortable; reports progress via onTick. */
export async function waitForSettlement(
  api: Api,
  jobId: string,
  { intervalMs = 1500, timeoutMs = 120_000, signal, onTick }: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal; onTick?: (job: Job) => void } = {},
): Promise<Job> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) throw new ApiError('Stopped waiting for the answer', 'network');
    let job: Job | null = null;
    try {
      job = await api.oracle.job(jobId, signal);
    } catch (err) {
      if (!isApiError(err, 'network') && !isApiError(err, 'timeout')) throw err;
    }
    if (job?.status === 'settled') return job;
    if (job) onTick?.(job);
    if (Date.now() + intervalMs > deadline) throw new ApiError(`No final answer within ${Math.round(timeoutMs / 1000)}s`, 'timeout');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
