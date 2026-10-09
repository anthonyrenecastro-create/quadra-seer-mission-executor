// Runnable: node collab/snapshot.js [--label <label>] [--keep <n>]
// Takes a store snapshot and prunes old ones beyond retention.
// Intended for cron / systemd timers, e.g. daily:
//   0 3 * * * cd /opt/quadra-seer && node collab/snapshot.js --label daily --keep 14
import { createStore } from './store.js';
import { fileURLToPath } from 'node:url';

const isMain = !!process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const li = args.indexOf('--label');
  const ki = args.indexOf('--keep');
  const label = (li !== -1 && args[li + 1]) || 'scheduled';
  const keep = parseInt((ki !== -1 && args[ki + 1]) || '14', 10) || 14;
  const store = createStore();
  const dest = store.snapshot(label);
  const pruned = store.pruneSnapshots(keep);
  console.log(JSON.stringify({ snapshot: dest, pruned, kept: keep }));
}
