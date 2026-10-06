import { id, nowIso } from '../ids.js';
import { requirePerm } from '../auth.js';

// Shared route helpers: mission lookup + auth, activity logging, history bumps.

export function getMission(store, missionId) {
  const m = store.get('missions', missionId);
  return m && !m.deleted ? m : null;
}

// Load mission, enforce `action` permission. Returns mission or null (response already sent).
export function needMission(req, res, store, action = 'read') {
  const mission = getMission(store, req.params.id || req.params.missionId);
  if (!mission) {
    res.status(404).json({ error: 'mission not found' });
    return null;
  }
  if (!requirePerm(res, req.actor, action, mission)) return null;
  return mission;
}

// Same but the mission id lives on a child record (evidence/branch/experiment/agent).
export function needMissionFor(store, record, req, res, action = 'read') {
  if (!record) {
    res.status(404).json({ error: 'record not found' });
    return null;
  }
  const mission = getMission(store, record.missionId);
  if (!mission) {
    res.status(404).json({ error: 'mission not found' });
    return null;
  }
  if (!requirePerm(res, req.actor, action, mission)) return null;
  return mission;
}

export function logActivity(store, { missionId, actor, type, summary, ref }) {
  store.log({
    id: id('act'),
    missionId: missionId || null,
    at: nowIso(),
    actor: actor && actor.id ? actor.id : String(actor || 'unknown'),
    type,
    summary: summary || '',
    ref: ref || { kind: '', id: '' },
  });
}

// Bump version + updatedAt + history entry; persists the record.
export function touch(store, coll, record, actor, change) {
  record.version = (record.version || 1) + 1;
  record.updatedAt = nowIso();
  record.history = record.history || [];
  record.history.push({
    v: record.version,
    at: nowIso(),
    actor: actor && actor.id ? actor.id : String(actor || 'unknown'),
    change: change || 'updated',
  });
  store.set(coll, record.id, record);
  return record;
}

// A human-readable stamp of "what evidence existed" for branch evidenceVersion.
export function evidenceVersionStamp(store, missionId) {
  const count = store.all('evidence').filter((e) => e.missionId === missionId && !e.deleted).length;
  return `${nowIso()}|${count}-items`;
}
