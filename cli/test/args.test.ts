import { describe, expect, it } from 'vitest';
import { parseArgs, parseDuration } from '../src/args.ts';

describe('cli args', () => {
  it('parses commands, positionals and flag styles', () => {
    expect(parseArgs(['ask', 'What', 'is', 'up?', '--tier', 'express', '--sponsored', '--image=./a.png', '--no-color'])).toEqual({
      command: 'ask',
      positional: ['What', 'is', 'up?'],
      flags: { tier: 'express', sponsored: true, image: './a.png', color: false },
    });
  });
  it('stops at --', () => {
    expect(parseArgs(['sandbox', '--', '--not-a-flag']).positional).toEqual(['--not-a-flag']);
  });
  it('reads durations', () => {
    expect(parseDuration('30s', 0)).toBe(30_000);
    expect(parseDuration('2m', 0)).toBe(120_000);
    expect(parseDuration(undefined, 5)).toBe(5);
    expect(() => parseDuration('soon', 0)).toThrow();
  });
});
