/**
 * Redaction for anything that leaves the browser for an error tracker.
 * Stellar keys, bearer tokens, JWTs and long hex strings are replaced, and
 * any object key that *sounds* sensitive is blanked regardless of value.
 */

const PATTERNS: RegExp[] = [
  /\b[GSCMT][A-Z2-7]{55,68}\b/g, // Stellar public / secret / contract / muxed keys
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, // JWT
  /\bpl1-\d+-\d+-\d+-[0-9a-f]+-[0-9a-f]{8}\b/gi, // recovery shares
  /\b[0-9a-f]{64}\b/gi,
];

const SENSITIVE_KEY = /secret|token|authorization|password|seed|mnemonic|private|kyc|cookie|address|pubkey|share|apikey|api_key/i;

export const REDACTED = '[redacted]';

export function scrubString(value: string): string {
  return PATTERNS.reduce((s, re) => s.replace(re, REDACTED), String(value));
}

export function scrubValue<T>(value: T, depth = 0): T {
  if (typeof value === 'string') return scrubString(value) as T;
  if (value === null || typeof value !== 'object' || depth > 8) return value;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : scrubValue(v, depth + 1);
  }
  return out as T;
}
