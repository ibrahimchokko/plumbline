/** Small, deterministic, non-cryptographic hashing used for bucketing
 * (feature-flag rollouts, A/B variants) and share checksums. */

export function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable 0..99 bucket for (key, id) — same user, same answer, every time. */
export function percentBucket(key: string, id: string): number {
  return fnv1a32(`${key}:${id}`) % 100;
}

export function pickVariant<T extends string>(experimentId: string, variants: readonly T[], subject: string): T {
  if (variants.length === 0) throw new Error('pickVariant needs at least one variant');
  return variants[fnv1a32(`${experimentId}:${subject}`) % variants.length];
}
