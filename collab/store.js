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
  }

  function readJson(name, fallback) {
    try {
      return JSON.parse(fs.readFileSync(fileFor(name), 'utf8'));
    } catch {
      return fallback;
    }
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
  };

  return api;
}
