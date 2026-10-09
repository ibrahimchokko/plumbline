/**
 * Exact USDC <-> stroop conversion.
 *
 * Stellar assets carry 7 decimal places, and the Soroban escrow contract
 * stores every amount as an i128 count of "stroops" (1 USDC = 10,000,000
 * stroops). All maths here is done on `bigint`, never on floating point,
 * so 0.1 + 0.2 style rounding errors can never move real money.
 */

export const STROOPS_PER_UNIT = 10_000_000n;
export const DECIMALS = 7;

const AMOUNT_RE = /^\d+(\.\d{1,7})?$/;

export class AmountError extends Error {
  override name = 'AmountError';
}

/** "1.5" -> 15000000n. Rejects negatives, exponents, >7 decimals and junk. */
export function toStroops(input: string | number): bigint {
  const text = String(input).trim();
  if (!AMOUNT_RE.test(text)) {
    throw new AmountError('Enter a positive amount with at most 7 decimal places (e.g. 2.5).');
  }
  const [whole, frac = ''] = text.split('.');
  return BigInt(whole) * STROOPS_PER_UNIT + BigInt(frac.padEnd(DECIMALS, '0') || '0');
}

/** 15000000n -> "1.5000000" (always 7 decimals, exact). */
export function fromStroops(stroops: bigint | string | number): string {
  const value = BigInt(stroops);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / STROOPS_PER_UNIT;
  const frac = (abs % STROOPS_PER_UNIT).toString().padStart(DECIMALS, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

/** Same as fromStroops but strips insignificant trailing zeros ("1.5"). */
export function fromStroopsCompact(stroops: bigint | string | number): string {
  return fromStroops(stroops).replace(/\.?0+$/, '') || '0';
}

/** Safe parse for display: returns null instead of throwing. */
export function tryToStroops(input: string | number | null | undefined): bigint | null {
  if (input === null || input === undefined || String(input).trim() === '') return null;
  try {
    return toStroops(input);
  } catch {
    return null;
  }
}

/**
 * Display formatter. `precision` is a *display* choice only (2 by default,
 * 7 for "show me every stroop"); it never affects what is signed or sent.
 */
export function formatUsdc(value: number | string | bigint | null | undefined, precision: 2 | 7 = 2): string {
  if (value === null || value === undefined || value === '') return '— USDC';
  if (typeof value === 'bigint') {
    const exact = fromStroops(value);
    return `${precision === 7 ? exact : Number(exact).toFixed(2)} USDC`;
  }
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(precision)} USDC` : '— USDC';
}
