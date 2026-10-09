import { randomUUID } from 'node:crypto';

// id(prefix) -> e.g. "msn_9f3ka1b2c4d5e6f7a8b9c0d1e2f3a4b5"
// Full 122-bit random UUID (32 hex chars). The old 8-char truncation had a
// ~50% collision chance at ~77k IDs with silent overwrite on collision;
// with 122 bits, collisions are cryptographically negligible.
// Prefixes in use: msn, ev, rel, br, mls, tsk, sm, exp, pkg, agt, run, act, upl
export function id(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

export function nowIso() {
  return new Date().toISOString();
}
