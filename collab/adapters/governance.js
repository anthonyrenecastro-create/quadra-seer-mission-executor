// Governance adapter: capability checks for agent tool execution.
// checkAgentCapability(agent, tool, target, opts) -> { ok, reason }.
// opts: { authorizeExternal?: bool, actor?: {id,name}, mission?: mission, external?: bool }
// Every denial reason is explicit; routes log each check to agent run history.

export const KNOWN_TOOLS = ['evidence.read', 'evidence.write', 'hrm.simulate'];

export function checkAgentCapability(agent, tool, target, opts = {}) {
  const a = agent || {};
  const allowedTools = Array.isArray(a.allowedTools) ? a.allowedTools : [];
  const perms = a.permissions || {};
  const allowedSources = Array.isArray(a.allowedSources) ? a.allowedSources : [];

  if (!KNOWN_TOOLS.includes(tool)) {
    return { ok: false, reason: `unknown tool '${tool}'` };
  }
  if (!allowedTools.includes(tool)) {
    return { ok: false, reason: `tool '${tool}' is not in the agent's allowedTools` };
  }
  if (tool === 'evidence.write' && !perms.write) {
    return { ok: false, reason: `agent lacks write permission (permissions.write is false)` };
  }
  if (tool === 'hrm.simulate' && !perms.execute) {
    return { ok: false, reason: `agent lacks execute permission (permissions.execute is false)` };
  }
  if ((tool === 'evidence.read' || tool === 'evidence.write') && target) {
    if (!allowedSources.includes(target)) {
      return { ok: false, reason: `evidence '${target}' is not in the agent's allowedSources` };
    }
  }
  if (opts.external) {
    if (!opts.authorizeExternal) {
      return { ok: false, reason: 'external write/deployment requires authorizeExternal: true in the run request' };
    }
    const role = roleOf(opts.mission, opts.actor && opts.actor.id);
    if (role !== 'owner' && role !== 'editor') {
      return { ok: false, reason: 'external write/deployment requires an owner or editor actor' };
    }
  }
  return { ok: true, reason: '' };
}

function roleOf(mission, actorId) {
  if (!mission || !actorId) return null;
  const c = (mission.contributors || []).find((x) => x.actor === actorId);
  return c ? c.role : null;
}
