import { randomUUID } from 'node:crypto';

// id(prefix) -> e.g. "msn_9f3ka1b2"
// Prefixes in use: msn, ev, rel, br, mls, tsk, sm, exp, pkg, agt, run, act, upl
export function id(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

export function nowIso() {
  return new Date().toISOString();
}
