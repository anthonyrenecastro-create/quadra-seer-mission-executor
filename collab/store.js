import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrations } from './migrations.js';
import { nowIso } from './ids.js';

const COLLECTIONS = [
  'missions',
  'evidence',
  'relations',
  'branches',
  'experiments',
  'contributions',
  'agents',
];

// File-backed JSON document store.
// - All maps keyed by id; activity is an append-only array.
// - Every write is atomic: JSON.stringify -> <file>.tmp -> fs.renameSync.
// - Corrupt files are QUARANTINED and load() throws — never silently replaced
//   with empty state (that turned one flipped byte into total collection loss).
// - meta.json carries { schemaVersion }; pending migrations run on load.
export function createStore(opts = {}) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dataDir =
    opts.dataDir || process.env.COLLAB_DATA_DIR || path.join(repoRoot, 'collab-data');

  const state = { data: {}, loaded: false };

  const fileFor = (name) => path.join(dataDir, `${name}.json`);

  function ensureDir() {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'packages'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'snapshots'), { recursive: true });
  }

  // Expected shapes per collection file: maps are objects, activity is an array.
  function shapeOk(name, value) {
    if (name === 'activity') return Array.isArray(value);
    if (name === 'meta') return value === null || typeof value === 'object';
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function quarantineCorrupt(name, file) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = `${file}.corrupt.${stamp}`;
    try {
      fs.renameSync(file, target);
    } catch {
      // If we can't even quarantine, fail loudly anyway.
    }
    const err = new Error(
      `collab store: ${name}.json is corrupt or has an unexpected shape ` +
      `(quarantined to ${path.basename(target)}). Refusing to load rather than ` +
      `risk silent data loss. Restore from a snapshot to recover.`,
    );
    err.code = 'ESTORECORRUPT';
    err.quarantine = target;
    throw err;
  }

  function readJson(name, fallback) {
    const file = fileFor(name);
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (e) {
      if (e && e.code === 'ENOENT') return fallback; // first boot: no file yet
      throw e; // permission errors etc. fail loudly
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      quarantineCorrupt(name, file);
    }
    if (!shapeOk(name, parsed)) quarantineCorrupt(name, file);
    return parsed;
  }

  function writeJson(name, value) {
    ensureDir();
    const tmp = `${fileFor(name)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, fileFor(name));
  }

  function load() {
    if (state.loaded) return state.data;
    ensureDir();
    const meta = readJson('meta', null);
    let version = meta && typeof meta.schemaVersion === 'number' ? meta.schemaVersion : 0;
    for (const c of COLLECTIONS) state.data[c] = readJson(c, {});
    state.data.activity = readJson('activity', []);
    for (const m of migrations) {
      if (m.version > version) {
        m.up(api);
        version = m.version;
      }
    }
    writeJson('meta', { schemaVersion: version, updatedAt: nowIso() });
    state.loaded = true;
    return state.data;
  }

  const api = {
    dataDir,
    repoRoot,
    collections: COLLECTIONS,

    load,

    schemaVersion() {
      load();
      return readJson('meta', {}).schemaVersion || 0;
    },

    get(coll, id) {
      load();
      const v = state.data[coll] ? state.data[coll][id] : undefined;
      return v === undefined ? null : v;
    },

    all(coll) {
      load();
      return Object.values(state.data[coll] || {});
    },

    set(coll, id, record) {
      load();
      state.data[coll][id] = record;
      writeJson(coll, state.data[coll]);
    },

    remove(coll, id) {
      load();
      delete state.data[coll][id];
      writeJson(coll, state.data[coll]);
    },

    activity() {
      load();
      return state.data.activity;
    },

    log(entry) {
      load();
      state.data.activity.push(entry);
      writeJson('activity', state.data.activity);
    },

    saveUpload(uploadId, buffer) {
      ensureDir();
      const tmp = path.join(dataDir, 'uploads', `${uploadId}.tmp`);
      const fin = path.join(dataDir, 'uploads', uploadId);
      fs.writeFileSync(tmp, buffer);
      fs.renameSync(tmp, fin);
      return fin;
    },

    readUpload(uploadId) {
      const p = path.join(dataDir, 'uploads', uploadId);
      return fs.existsSync(p) ? fs.readFileSync(p) : null;
    },

    savePackage(filename, buffer) {
      ensureDir();
      const tmp = path.join(dataDir, 'packages', `${filename}.tmp`);
      const fin = path.join(dataDir, 'packages', filename);
      fs.writeFileSync(tmp, buffer);
      fs.renameSync(tmp, fin);
      return fin;
    },

    // ---- Durability: snapshots, export, restore ----

    snapshotsDir() {
      ensureDir();
      return path.join(dataDir, 'snapshots');
    },

    // Copy every collection file + meta into snapshots/<stamp>-<label>/.
    snapshot(label = 'manual') {
      load();
      ensureDir();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safeLabel = String(label).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'manual';
      const dest = path.join(dataDir, 'snapshots', `${stamp}-${safeLabel}`);
      fs.mkdirSync(dest, { recursive: true });
      for (const name of [...COLLECTIONS, 'activity', 'meta']) {
        const src = fileFor(name);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dest, `${name}.json`));
      }
      return dest;
    },

    listSnapshots() {
      const dir = this.snapshotsDir();
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
        .reverse(); // newest first
    },

    // Restore a snapshot by name. Takes a safety snapshot of current state first
    // so a bad restore is reversible. Returns { restored, safetySnapshot }.
    restoreSnapshot(name) {
      const src = path.join(this.snapshotsDir(), name);
      if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
        const err = new Error(`snapshot not found: ${name}`);
        err.code = 'ENOSNAPSHOT';
        throw err;
      }
      const safety = this.snapshot('pre-restore');
      for (const cname of [...COLLECTIONS, 'activity', 'meta']) {
        const sfile = path.join(src, `${cname}.json`);
        if (fs.existsSync(sfile)) {
          const tmp = `${fileFor(cname)}.tmp`;
          fs.copyFileSync(sfile, tmp);
          fs.renameSync(tmp, fileFor(cname));
        }
      }
      state.loaded = false; // force reload from restored files
      load();
      return { restored: name, safetySnapshot: path.basename(safety) };
    },

    // Keep the N newest snapshots, delete the rest. Returns deleted count.
    pruneSnapshots(keep = 10) {
      const all = this.listSnapshots();
      const doomed = all.slice(keep);
      for (const name of doomed) {
        fs.rmSync(path.join(this.snapshotsDir(), name), { recursive: true, force: true });
      }
      return doomed.length;
    },

    // Whole-store export as a plain object (for download / backup).
    // Deep-cloned: the export is a point-in-time snapshot, not a live
    // reference into the store (later writes must not mutate the export).
    exportAll() {
      load();
      const out = { format: 'quadra-seer-store-export/v1', exportedAt: nowIso(), collections: {} };
      for (const cname of [...COLLECTIONS, 'activity']) {
        out.collections[cname] = JSON.parse(JSON.stringify(state.data[cname]));
      }
      out.collections.meta = JSON.parse(JSON.stringify(readJson('meta', {})));
      return out;
    },

    // Whole-store import. Validates shape, snapshots current state first.
    // Throws on invalid payload — never half-applies.
    importAll(payload) {
      if (!payload || payload.format !== 'quadra-seer-store-export/v1' ||
          !payload.collections || typeof payload.collections !== 'object') {
        const err = new Error('invalid store export payload');
        err.code = 'EBADEXPORT';
        throw err;
      }
      for (const cname of [...COLLECTIONS, 'activity']) {
        if (!shapeOk(cname, payload.collections[cname])) {
          const err = new Error(`invalid store export payload: bad shape for ${cname}`);
          err.code = 'EBADEXPORT';
          throw err;
        }
      }
      const safety = this.snapshot('pre-import');
      for (const cname of [...COLLECTIONS, 'activity']) {
        writeJson(cname, payload.collections[cname]);
      }
      if (payload.collections.meta) writeJson('meta', payload.collections.meta);
      state.loaded = false;
      load();
      return { safetySnapshot: path.basename(safety) };
    },
  };

  return api;
}
