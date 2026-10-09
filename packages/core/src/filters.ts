import { tryToStroops } from './money.ts';
import type { AdminTransaction, PayerQuestion } from './types.ts';

/** The three states a question can be in, from the asker's point of view. */
export type QuestionState = 'in-progress' | 'resolved' | 'refunded' | 'cancelled';

export function questionState(q: Pick<PayerQuestion, 'status' | 'outcome'>): QuestionState {
  if (q.status === 'cancelled' || q.outcome === 'cancelled') return 'cancelled';
  if (q.status !== 'settled') return 'in-progress';
  return q.outcome === 'resolved' ? 'resolved' : 'refunded';
}

export interface QuestionFilter {
  query?: string;
  state?: QuestionState | 'all';
  starredOnly?: boolean;
  starred?: ReadonlySet<string>;
}

export function filterQuestions<T extends PayerQuestion>(questions: readonly T[], f: QuestionFilter = {}): T[] {
  const needle = (f.query ?? '').trim().toLowerCase();
  return questions.filter((q) => {
    if (f.state && f.state !== 'all' && questionState(q) !== f.state) return false;
    if (f.starredOnly && !f.starred?.has(q.questionId)) return false;
    if (!needle) return true;
    return (
      String(q.question ?? '').toLowerCase().includes(needle) ||
      String(q.questionId ?? '').toLowerCase().includes(needle) ||
      String(q.answer ?? '').toLowerCase().includes(needle)
    );
  });
}

export interface TxFilter {
  from?: string; // YYYY-MM-DD, inclusive
  to?: string; // YYYY-MM-DD, inclusive (whole day)
  minUsdc?: string;
  maxUsdc?: string;
  status?: string;
  outcome?: string;
  query?: string;
}

function day(value: string | undefined, endOfDay: boolean): number | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime() : new Date(y, m - 1, d).getTime();
}

export function filterTransactions<T extends AdminTransaction>(rows: readonly T[], f: TxFilter = {}): T[] {
  const from = day(f.from, false);
  const to = day(f.to, true);
  const min = tryToStroops(f.minUsdc);
  const max = tryToStroops(f.maxUsdc);
  const needle = (f.query ?? '').trim().toLowerCase();

  return rows.filter((t) => {
    if (f.status && (t.status ?? '') !== f.status) return false;
    if (f.outcome && (t.outcome ?? '') !== f.outcome) return false;
    if (needle && !`${t.questionId} ${t.payer ?? ''}`.toLowerCase().includes(needle)) return false;
    if (from !== null || to !== null) {
      const at = t.createdAt !== undefined ? new Date(t.createdAt).getTime() : NaN;
      if (Number.isNaN(at)) return false;
      if (from !== null && at < from) return false;
      if (to !== null && at > to) return false;
    }
    if (min !== null || max !== null) {
      let amount: bigint;
      try {
        amount = BigInt(t.amountStroops ?? 'x');
      } catch {
        return false;
      }
      if (min !== null && amount < min) return false;
      if (max !== null && amount > max) return false;
    }
    return true;
  });
}

export function distinctValues<T>(rows: readonly T[], key: keyof T): string[] {
  return [...new Set(rows.map((r) => r[key]).filter(Boolean).map(String))].sort();
}

/** Daily spend totals for the asker's spend calendar (last `days` days with data). */
export function dailyTotals(questions: readonly PayerQuestion[], days = 84): Array<{ day: string; amount: number }> {
  const totals = new Map<string, number>();
  for (const q of questions) {
    if (q.createdAt === undefined) continue;
    const date = new Date(q.createdAt);
    const amount = Number(q.amount ?? 0);
    if (Number.isNaN(date.valueOf()) || !Number.isFinite(amount)) continue;
    const key = date.toISOString().slice(0, 10);
    totals.set(key, (totals.get(key) ?? 0) + amount);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-days)
    .map(([d, amount]) => ({ day: d, amount }));
}

/** 10 buckets of 10% for the verifier match-ratio histogram. */
export function ratioHistogram(ratios: readonly number[]): number[] {
  const buckets = new Array<number>(10).fill(0);
  for (const r of ratios) {
    if (!Number.isFinite(r)) continue;
    buckets[Math.min(9, Math.max(0, Math.floor(r * 10)))]++;
  }
  return buckets;
}
