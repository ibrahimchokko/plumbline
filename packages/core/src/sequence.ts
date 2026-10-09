/**
 * Ordered-event bookkeeping for the asker's live status stream.
 *
 * The backend tags every status change for a payer with a contiguous,
 * monotonic sequence number. This tracker decides, for each incoming
 * event, whether to apply it, drop it (a duplicate from replay overlap or
 * our own broadcast echo) or trigger a resync (we missed something).
 * Pure logic, no I/O — which is what makes it unit-testable.
 */

export type SeqDecision = 'apply' | 'duplicate' | 'gap';

export class SequenceTracker {
  private cursor: number;

  constructor(start = 0) {
    this.cursor = start;
  }

  get position(): number {
    return this.cursor;
  }

  /** Called after a fresh snapshot: never move backwards. */
  reset(snapshotCursor: number): void {
    if (Number.isFinite(snapshotCursor)) this.cursor = Math.max(this.cursor, snapshotCursor);
  }

  offer(seq: number): SeqDecision {
    if (!Number.isFinite(seq) || seq <= this.cursor) return 'duplicate';
    if (this.cursor > 0 && seq > this.cursor + 1) return 'gap';
    this.cursor = seq;
    return 'apply';
  }
}

/** Exponential backoff with a ceiling and optional jitter. */
export function backoffDelay(attempt: number, { baseMs = 1000, maxMs = 30_000, jitter = 0.2 } = {}): number {
  const raw = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  const spread = raw * jitter;
  return Math.round(raw - spread + Math.random() * spread * 2);
}
