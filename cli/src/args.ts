/**
 * Tiny, dependency-free argument parser.
 *   plumb ask "What is 2+2?" --tier express --sponsored
 * -> { command: 'ask', positional: ['What is 2+2?'], flags: { tier: 'express', sponsored: true } }
 * Supports --key value, --key=value, boolean --flag, --no-flag, and `--` to stop parsing.
 */
export interface Parsed {
  command: string | null;
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let rest = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (rest) {
      positional.push(a);
      continue;
    }
    if (a === '--') {
      rest = true;
      continue;
    }
    if (a.startsWith('--')) {
      const body = a.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) flags[body.slice(0, eq)] = body.slice(eq + 1);
      else if (body.startsWith('no-')) flags[body.slice(3)] = false;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[body] = argv[++i];
      else flags[body] = true;
      continue;
    }
    if (a.startsWith('-') && a.length === 2) {
      flags[a.slice(1)] = true;
      continue;
    }
    positional.push(a);
  }
  const [command = null, ...others] = positional;
  return { command, positional: others, flags };
}

export const flagString = (f: Parsed['flags'], key: string): string | undefined => (typeof f[key] === 'string' ? (f[key] as string) : undefined);
export const flagBool = (f: Parsed['flags'], key: string): boolean => f[key] === true || f[key] === 'true';
export function flagNumber(f: Parsed['flags'], key: string, fallback: number): number {
  const v = flagString(f, key);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${key} must be a number`);
  return n;
}

/** "30s" / "2m" / "1500" (ms) -> milliseconds */
export function parseDuration(v: string | undefined, fallbackMs: number): number {
  if (!v) return fallbackMs;
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(v.trim());
  if (!m) throw new Error(`could not read duration "${v}" (try 30s, 2m, 1500ms)`);
  const n = Number(m[1]);
  return Math.round(n * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000 } as const)[(m[2] ?? 'ms') as 'ms' | 's' | 'm' | 'h']);
}
