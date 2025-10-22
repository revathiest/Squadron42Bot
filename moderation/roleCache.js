const roleCache = new Map(); // guildId -> Map(action -> Set(roleId))

function ensureActionMap(guildId) {
  let actionMap = roleCache.get(guildId);
  if (!actionMap) {
    actionMap = new Map();
    roleCache.set(guildId, actionMap);
  }
  return actionMap;
}

function getActionRoles(guildId, action) {
  const actions = roleCache.get(guildId);
  return actions ? actions.get(action) || new Set() : new Set();
}

function addRoleToCache(guildId, action, roleId) {
  const actionMap = ensureActionMap(guildId);
  let roles = actionMap.get(action);
  if (!roles) {
    roles = new Set();
    actionMap.set(action, roles);
  }
  roles.add(roleId);
}

function removeRoleFromCache(guildId, action, roleId) {
  const actionMap = roleCache.get(guildId);
  if (!actionMap) {
    return;
  }

  const roles = actionMap.get(action);
  if (!roles) {
    return;
  }

  roles.delete(roleId);
  if (roles.size === 0) {
    actionMap.delete(action);
  }

  if (actionMap.size === 0) {
    roleCache.delete(guildId);
  }
}

function memberHasRole(member, roleId) {
  if (!member || !roleId) {
    return false;
  }

  const cache = member.roles?.cache;
  if (!cache) {
    return false;
  }

  if (typeof cache.has === 'function') {
    return cache.has(roleId);
  }

  if (typeof cache.some === 'function') {
    return cache.some(role => (role?.id ?? role) === roleId);
  }

  if (Array.isArray(cache)) {
    return cache.some(role => (role?.id ?? role) === roleId);
  }

  return false;
}

function hasActionPermission(guildId, member, action) {
  if (!member) {
    return false;
  }

  const configuredRoles = getActionRoles(guildId, action);
  if (configuredRoles.size === 0) {
    return false;
  }

  for (const roleId of configuredRoles) {
    if (memberHasRole(member, roleId)) {
      return true;
    }
  }

  return false;
}

module.exports = {
  roleCache,
  addRoleToCache,
  removeRoleFromCache,
  getActionRoles,
  memberHasRole,
  hasActionPermission
};
