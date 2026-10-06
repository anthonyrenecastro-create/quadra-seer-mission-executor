// Auth: two modes via COLLAB_AUTH env.
//   disabled (default) -> single local actor, everything allowed.
//   token            -> require Authorization: Bearer <token>; actor resolved from
//                       COLLAB_ACTORS JSON ({"token": {"id","name"}}) or COLLAB_API_TOKEN.
//
// Mission roles: contributors: [{ actor, role }] with owner | editor | viewer.
// can(actor, action, mission) enforces the matrix below; routes return 403 { error }.

const VALID_ROLES = ['owner', 'editor', 'viewer'];

const MATRIX = {
  read: ['viewer', 'editor', 'owner'],
  create: ['editor', 'owner'],
  edit: ['editor', 'owner'],
  archive: ['owner'],
  reopen: ['owner'],
  delete: ['owner'],
  manageContributors: ['owner'],
  publish: ['owner'],
  authorizeExternal: ['owner', 'editor'],
  seed: ['owner'],
};

export function authMode() {
  return process.env.COLLAB_AUTH === 'token' ? 'token' : 'disabled';
}

function actorsMap() {
  try {
    const raw = process.env.COLLAB_ACTORS || '{}';
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// Returns { actor } on success, or { error, status } on failure.
export function resolveActor(req) {
  if (authMode() === 'disabled') {
    return { actor: { id: 'local-owner', name: 'Local owner' } };
  }
  const header = req.headers['authorization'] || req.headers['Authorization'] || '';
  const m = /^Bearer\s+(.+)$/.exec(String(header).trim());
  if (!m) return { error: 'missing or malformed Authorization Bearer token', status: 401 };
  const token = m[1];
  const map = actorsMap();
  if (map[token] && map[token].id) {
    return { actor: { id: String(map[token].id), name: String(map[token].name || map[token].id) } };
  }
  if (process.env.COLLAB_API_TOKEN && token === process.env.COLLAB_API_TOKEN) {
    return { actor: { id: 'token-owner', name: 'API token owner' } };
  }
  return { error: 'invalid token', status: 401 };
}

export function roleOf(mission, actorId) {
  const c = (mission.contributors || []).find((x) => x.actor === actorId);
  return c ? c.role : null;
}

export function can(actor, action, mission) {
  if (authMode() === 'disabled') return true;
  if (!mission) return true; // no mission context: any authenticated actor may create/list
  const role = roleOf(mission, actor.id);
  if (!role) return false;
  return (MATRIX[action] || []).includes(role);
}

export function validRoles() {
  return VALID_ROLES.slice();
}

// Express middleware: attaches req.actor or rejects with 401.
export function authMiddleware(req, res, next) {
  const r = resolveActor(req);
  if (r.error) return res.status(r.status).json({ error: r.error });
  req.actor = r.actor;
  next();
}

// Helper for routes: enforce can(); sends 403 and returns false on denial.
export function requirePerm(res, actor, action, mission) {
  if (can(actor, action, mission)) return true;
  res.status(403).json({
    error: `forbidden: role '${roleOf(mission, actor.id) || 'none'}' cannot '${action}'`,
  });
  return false;
}
