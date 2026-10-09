/**
 * Backend compatibility check.
 *
 * The original app compared versions as exact strings, so a harmless
 * backend patch release (1.0.0 -> 1.0.1) raised a scary "mismatch" banner.
 * Here we follow semver: a different MAJOR is incompatible, a newer MINOR
 * or PATCH on the backend is fine, an *older* backend minor is a soft
 * warning (a feature we rely on may be missing).
 */

export type Compatibility = 'match' | 'compatible' | 'older-minor' | 'incompatible' | 'unknown';

function parse(v: string): [number, number, number] | null {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(v).trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

export function checkCompatibility(expected: string, reported: string | null | undefined): Compatibility {
  if (reported === null || reported === undefined || reported === '') return 'unknown';
  const a = parse(expected);
  const b = parse(String(reported));
  if (!a || !b) return 'unknown';
  if (a[0] !== b[0]) return 'incompatible';
  if (a[1] === b[1] && a[2] === b[2]) return 'match';
  if (b[1] < a[1]) return 'older-minor';
  return 'compatible';
}
