import { Router } from 'express';
import { id, nowIso } from '../ids.js';
import { parseUpload } from '../uploads.js';
import { needMission, needMissionFor, logActivity, touch } from './_util.js';

const KINDS = ['document', 'dataset', 'claim', 'question', 'assumption', 'decision', 'experiment-result'];
const CLAIM_STATUSES = ['unreviewed', 'supported', 'disputed', 'insufficient-evidence'];
const REL_TYPES = ['supports', 'contradicts', 'depends-on', 'derived-from', 'tests'];

export function createEvidenceRouter(store) {
  const r = Router();

  const visible = (e) => !e.deleted;

  // List with filters.
  r.get('/missions/:id/evidence', (req, res) => {
    const m = needMission(req, res, store, 'read');
    if (!m) return;
    let items = store.all('evidence').filter((e) => e.missionId === m.id && visible(e));
    if (req.query.kind) items = items.filter((e) => e.kind === req.query.kind);
    if (req.query.claimStatus) items = items.filter((e) => e.claimStatus === req.query.claimStatus);
    if (req.query.q) {
      const q = String(req.query.q).toLowerCase();
      items = items.filter((e) =>
        String(e.title || '').toLowerCase().includes(q) ||
        String(e.content && e.content.text || '').toLowerCase().includes(q) ||
        String(e.source || '').toLowerCase().includes(q));
    }
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json({ evidence: items });
  });

  // Create evidence.
  r.post('/missions/:id/evidence', (req, res) => {
    const m = needMission(req, res, store, 'create');
    if (!m) return;
    const b = req.body || {};
    if (!KINDS.includes(b.kind)) {
      return res.status(400).json({ error: `kind must be one of ${KINDS.join(', ')}` });
    }
    const ev = {
      id: id('ev'),
      missionId: m.id,
      kind: b.kind,
      title: b.title || '',
      source: b.source || '',
      author: b.author || req.actor.name || req.actor.id,
      createdAt: nowIso(),
      version: 1,
      permissions: b.permissions === 'private' ? 'private' : 'mission',
      locator: b.locator && typeof b.locator === 'object' ? b.locator : { page: 0, sheet: '', row: 0, excerpt: '' },
      content: {
        text: b.content && typeof b.content.text === 'string' ? b.content.text : (typeof b.text === 'string' ? b.text : ''),
        parseStatus: (b.content && b.content.parseStatus) || 'parsed',
        format: (b.content && b.content.format) || '',
        uploadId: (b.content && b.content.uploadId) || '',
      },
      claimStatus: 'unreviewed',
      statusHistory: [],
      importedFrom: null,
      history: [{ v: 1, at: nowIso(), actor: req.actor.id, change: 'evidence created' }],
    };
    if (b.kind === 'claim' && b.claimStatus && CLAIM_STATUSES.includes(b.claimStatus) && b.claimStatus !== 'unreviewed') {
      if (!b.why) return res.status(400).json({ error: 'claimStatus change requires why' });
      ev.claimStatus = b.claimStatus;
      ev.statusHistory.push({ at: nowIso(), actor: req.actor.id, from: 'unreviewed', to: b.claimStatus, why: String(b.why), aiSuggested: !!b.aiSuggested });
    }
    store.set('evidence', ev.id, ev);
    logActivity(store, { missionId: m.id, actor: req.actor, type: 'evidence.added', summary: `Evidence added: ${ev.title || ev.kind}`, ref: { kind: 'evidence', id: ev.id } });
    res.status(201).json({ evidence: ev });
  });

  // Base64 upload -> parsed evidence (honest statuses; raw bytes stored).
  r.post('/missions/:id/evidence/upload', (req, res) => {
    const m = needMission(req, res, store, 'create');
    if (!m) return;
    const b = req.body || {};
    const parsed = parseUpload({ filename: b.filename, mimeType: b.mimeType, contentBase64: b.contentBase64 });
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const uploadId = id('upl');
    store.saveUpload(uploadId, parsed.buffer);
    const ev = {
      id: id('ev'),
      missionId: m.id,
      kind: parsed.mimeType === 'text/csv' || /\.csv$/i.test(parsed.filename) ? 'dataset' : 'document',
      title: parsed.filename,
      source: `upload:${parsed.filename}`,
      author: req.actor.name || req.actor.id,
      createdAt: nowIso(),
      version: 1,
      permissions: 'mission',
      locator: parsed.locator,
      content: { text: parsed.text, parseStatus: parsed.parseStatus, format: parsed.format, uploadId, note: parsed.note },
      claimStatus: 'unreviewed',
      statusHistory: [],
      importedFrom: null,
      history: [{ v: 1, at: nowIso(), actor: req.actor.id, change: `uploaded ${parsed.filename} (${parsed.parseStatus})` }],
    };
    store.set('evidence', ev.id, ev);
    logActivity(store, { missionId: m.id, actor: req.actor, type: 'evidence.added', summary: `Upload: ${parsed.filename} (${parsed.parseStatus})`, ref: { kind: 'evidence', id: ev.id } });
    res.status(201).json({ evidence: ev, parseStatus: parsed.parseStatus, note: parsed.note, uploadId });
  });

  r.get('/evidence/:id', (req, res) => {
    const ev = store.get('evidence', req.params.id);
    const m = needMissionFor(store, ev && visible(ev) ? ev : null, req, res, 'read');
    if (!m) return;
    res.json({ evidence: ev });
  });

  // Edit. claimStatus changes REQUIRE why; recorded with actor + aiSuggested flag.
  r.patch('/evidence/:id', (req, res) => {
    let ev = store.get('evidence', req.params.id);
    const m = needMissionFor(store, ev && visible(ev) ? ev : null, req, res, 'edit');
    if (!m) return;
    ev = store.get('evidence', req.params.id);
    const b = req.body || {};
    const changed = [];
    for (const f of ['title', 'source', 'author', 'permissions']) {
      if (typeof b[f] === 'string' && b[f] !== ev[f]) { ev[f] = b[f]; changed.push(f); }
    }
    if (b.locator && typeof b.locator === 'object') { ev.locator = { ...ev.locator, ...b.locator }; changed.push('locator'); }
    if (b.content && typeof b.content === 'object') {
      if (typeof b.content.text === 'string') ev.content.text = b.content.text;
      changed.push('content');
    }
    if (b.claimStatus && b.claimStatus !== ev.claimStatus) {
      if (!CLAIM_STATUSES.includes(b.claimStatus)) {
        return res.status(400).json({ error: `claimStatus must be one of ${CLAIM_STATUSES.join(', ')}` });
      }
      if (!b.why || !String(b.why).trim()) {
        return res.status(400).json({ error: 'claimStatus change requires why' });
      }
      ev.statusHistory.push({
        at: nowIso(), actor: req.actor.id, from: ev.claimStatus, to: b.claimStatus,
        why: String(b.why), aiSuggested: !!b.aiSuggested,
      });
      ev.claimStatus = b.claimStatus;
      changed.push('claimStatus');
      logActivity(store, { missionId: m.id, actor: req.actor, type: 'evidence.status-changed', summary: `Claim status → ${b.claimStatus}: ${ev.title}`, ref: { kind: 'evidence', id: ev.id } });
    }
    if (changed.length === 0) return res.status(400).json({ error: 'nothing to update' });
    touch(store, 'evidence', ev, req.actor, `updated: ${changed.join(', ')}`);
    res.json({ evidence: ev });
  });

  // Tombstone: keep the record, mark deleted, record in history.
  r.delete('/evidence/:id', (req, res) => {
    let ev = store.get('evidence', req.params.id);
    const m = needMissionFor(store, ev && visible(ev) ? ev : null, req, res, 'edit');
    if (!m) return;
    ev = store.get('evidence', req.params.id);
    ev.deleted = true;
    touch(store, 'evidence', ev, req.actor, 'tombstoned (record retained)');
    logActivity(store, { missionId: m.id, actor: req.actor, type: 'evidence.status-changed', summary: `Evidence tombstoned: ${ev.title}`, ref: { kind: 'evidence', id: ev.id } });
    res.json({ evidence: ev });
  });

  // Relations.
  r.get('/missions/:id/relations', (req, res) => {
    const m = needMission(req, res, store, 'read');
    if (!m) return;
    res.json({ relations: store.all('relations').filter((x) => x.missionId === m.id) });
  });

  r.post('/missions/:id/relations', (req, res) => {
    const m = needMission(req, res, store, 'create');
    if (!m) return;
    const b = req.body || {};
    if (!REL_TYPES.includes(b.type)) {
      return res.status(400).json({ error: `type must be one of ${REL_TYPES.join(', ')}` });
    }
    const from = store.get('evidence', b.from);
    const to = store.get('evidence', b.to);
    if (!from || from.deleted || from.missionId !== m.id || !to || to.deleted || to.missionId !== m.id) {
      return res.status(400).json({ error: 'from/to must be evidence items in this mission' });
    }
    const rel = {
      id: id('rel'), missionId: m.id, from: from.id, to: to.id,
      type: b.type, note: b.note || '', createdBy: req.actor.id, createdAt: nowIso(),
    };
    store.set('relations', rel.id, rel);
    logActivity(store, { missionId: m.id, actor: req.actor, type: 'relation.added', summary: `Relation: ${from.title} ${b.type} ${to.title}`, ref: { kind: 'relation', id: rel.id } });
    res.status(201).json({ relation: rel });
  });

  r.delete('/relations/:id', (req, res) => {
    const rel = store.get('relations', req.params.id);
    if (!rel) return res.status(404).json({ error: 'relation not found' });
    const m = needMissionFor(store, { missionId: rel.missionId }, req, res, 'edit');
    if (!m) return;
    store.remove('relations', rel.id);
    res.json({ deleted: rel.id });
  });

  // Downstream impact: claims/decisions reachable from this evidence.
  r.get('/evidence/:id/impacted', (req, res) => {
    const ev = store.get('evidence', req.params.id);
    const m = needMissionFor(store, ev && visible(ev) ? ev : null, req, res, 'read');
    if (!m) return;
    const rels = store.all('relations').filter((x) => x.missionId === m.id);
    const seen = new Set([ev.id]);
    const queue = [ev.id];
    const impacted = [];
    while (queue.length) {
      const cur = queue.shift();
      for (const rel of rels) {
        let next = null;
        // evidence --supports/contradicts/tests--> claim: claim is downstream
        if (rel.from === cur && ['supports', 'contradicts', 'tests'].includes(rel.type)) next = rel.to;
        // X --derived-from/depends-on--> evidence: X is downstream
        if (rel.to === cur && ['derived-from', 'depends-on'].includes(rel.type)) next = rel.from;
        if (next && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
          const item = store.get('evidence', next);
          if (item && !item.deleted && (item.kind === 'claim' || item.kind === 'decision')) impacted.push(item);
        }
      }
    }
    res.json({
      claims: impacted.filter((x) => x.kind === 'claim'),
      decisions: impacted.filter((x) => x.kind === 'decision'),
    });
  });

  return r;
}
