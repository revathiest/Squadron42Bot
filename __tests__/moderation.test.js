jest.mock(require('path').resolve(__dirname, '..', 'database'), () => {
  const query = jest.fn().mockResolvedValue([[]]);
  const pool = { query };
  return {
    getPool: jest.fn(() => pool),
    testConnection: jest.fn(),
    __pool: pool
  };
});

jest.mock('../moderation/handlers/orgLinks', () => ({
  handleMessageCreate: jest.fn().mockResolvedValue(undefined),
  loadOrgForumCache: jest.fn().mockResolvedValue(undefined)
}));

const path = require('path');
const { ApplicationCommandType, ApplicationCommandOptionType, MessageFlags, PermissionFlagsBits, Events } = require('discord.js');

const database = require(path.resolve(__dirname, '..', 'database'));
const moderation = require('../moderation');
const autoBanTrap = require('../moderation/autoBanTrap');
const orgLinkHandler = require('../moderation/handlers/orgLinks');
const { logAction } = require('../moderation/utils');

const flushPromises = () => new Promise(resolve => setImmediate(resolve));

beforeEach(() => {
  moderation.__testables.resetInitialization();
});

const {
  ACTIONS,
  roleCache,
  addRoleToCache,
  removeRoleFromCache,
  memberHasRole,
  hasActionPermission,
  handleModCommand,
  handleInteraction,
  handleTrapConfigCommand,
  handleAutoBanRoleUpdate,
  fetchTrapRoleId,
  isTrapRoleNewlyAssigned,
} = moderation.__testables;

const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
beforeAll(() => {
  console.error = jest.fn();
  console.warn = jest.fn();
});

afterAll(() => {
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
});

describe('memberHasRole', () => {
  test('returns false when member missing', () => {
    expect(memberHasRole(null, 'role')).toBe(false);
    expect(memberHasRole({ roles: null }, 'role')).toBe(false);
  });

  test('uses cache.has when available', () => {
    const member = {
      roles: {
        cache: {
          has: jest.fn(value => value === 'role-has')
        }
      }
    };

    expect(memberHasRole(member, 'role-has')).toBe(true);
    expect(member.roles.cache.has).toHaveBeenCalledWith('role-has');
  });

  test('uses cache.some when available', () => {
    const member = {
      roles: {
        cache: {
          some: jest.fn(fn => fn({ id: 'role-some' }))
        }
      }
    };

    expect(memberHasRole(member, 'role-some')).toBe(true);
    expect(member.roles.cache.some).toHaveBeenCalled();
  });

  test('supports array caches', () => {
    const member = {
      roles: { cache: [{ id: 'role-array' }] }
    };

    expect(memberHasRole(member, 'role-array')).toBe(true);
  });

  test('returns false when role not present', () => {
    const member = {
      roles: { cache: [{ id: 'role-a' }] }
    };

    expect(memberHasRole(member, 'role-b')).toBe(false);
  });

  test('returns false for unsupported cache shape', () => {
    const member = {
      roles: { cache: { entries: [] } }
    };

    expect(memberHasRole(member, 'role-any')).toBe(false);
  });
});

describe('moderation command definitions', () => {
  test('exposes only the /mod slash command', () => {
    const defs = moderation.getSlashCommandDefinitions();

    const slash = defs.guild.find(def => def.name === 'mod');
    expect(slash).toBeDefined();
    expect(slash.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'roles' }),
      expect.objectContaining({ name: 'auto-ban' })
    ]));

    expect(defs.guild.length).toBe(1);
    expect(defs.global).toEqual([]);
  });
});

describe('handleInteraction', () => {
  beforeEach(() => {
    database.__pool.query.mockReset();
    database.__pool.query.mockResolvedValue([[]]);
  });

  test('routes mod slash command through handler', async () => {
    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'mod',
      options: {
        getSubcommandGroup: () => null
      },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await expect(handleInteraction(interaction)).resolves.toBe(true);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Unsupported moderation command.'
    }));
  });

});

describe('moderation initialize', () => {
  beforeEach(() => {
    database.__pool.query.mockReset();
    database.__pool.query.mockResolvedValue([[]]);
  });
  test('onReady bootstraps when not initialized', async () => {
    const client = { on: jest.fn() };

    await moderation.onReady(client);

    expect(client.on).toHaveBeenCalledWith(Events.GuildMemberUpdate, expect.any(Function));
    expect(client.on).toHaveBeenCalledWith(Events.MessageCreate, expect.any(Function));
  });


  test('initializes schema and auto-ban listener once', async () => {
    const client = { on: jest.fn() };
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const originalRegister = autoBanTrap.registerAutoBanTrap;
    const registerSpy = jest.spyOn(autoBanTrap, 'registerAutoBanTrap').mockImplementation(clientArg => originalRegister(clientArg));

    await moderation.initialize(client);

    expect(database.__pool.query.mock.calls.length).toBeGreaterThanOrEqual(4);
    const queries = database.__pool.query.mock.calls.map(call => call[0]);
    expect(queries.some(sql => typeof sql === 'string' && sql.includes('moderation_config'))).toBe(true);
    expect(registerSpy).toHaveBeenCalledWith(client);
    expect(client.on).toHaveBeenCalledWith(Events.GuildMemberUpdate, expect.any(Function));
    expect(client.on).toHaveBeenCalledWith(Events.MessageCreate, expect.any(Function));
    expect(client.on.mock.calls.some(call => call[0] === Events.InteractionCreate)).toBe(false);

    const messageHandler = client.on.mock.calls.find(call => call[0] === Events.MessageCreate)[1];
    orgLinkHandler.handleMessageCreate.mockRejectedValueOnce(new Error('boom'));
    messageHandler({});
    await flushPromises();
    expect(errorSpy).toHaveBeenCalledWith('moderation: org link moderation failed', expect.any(Error));

    await moderation.initialize(client);

    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(client.on.mock.calls.filter(call => call[0] === Events.GuildMemberUpdate)).toHaveLength(1);
    expect(client.on.mock.calls.filter(call => call[0] === Events.MessageCreate)).toHaveLength(1);

    registerSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('hasActionPermission', () => {
  beforeEach(() => {
    roleCache.clear();
  });

  test('grants access when member has configured role', () => {
    addRoleToCache('guild-1', 'warn', 'role-123');
    const member = {
      roles: { cache: { has: roleId => roleId === 'role-123' } },
      permissions: { has: () => false }
    };

    expect(hasActionPermission('guild-1', member, 'warn')).toBe(true);
  });

  test('denies access when no roles configured even with permission bits', () => {
    const member = {
      permissions: { has: perm => perm === PermissionFlagsBits.ModerateMembers }
    };

    expect(hasActionPermission('guild-2', member, 'warn')).toBe(false);
  });

  test('denies access when missing role and permission', () => {
    addRoleToCache('guild-3', 'kick', 'role-abc');
    const member = {
      roles: { cache: { has: () => false } },
      permissions: { has: () => false }
    };

    expect(hasActionPermission('guild-3', member, 'kick')).toBe(false);
  });

  test('supports Collection.some fallback detection', () => {
    addRoleToCache('guild-4', 'warn', 'role-some');
    const member = {
      roles: {
        cache: {
          has: undefined,
          some: fn => fn({ id: 'role-some' })
        }
      },
      permissions: { has: () => false }
    };

    expect(hasActionPermission('guild-4', member, 'warn')).toBe(true);
  });

  test('supports array style role cache', () => {
    addRoleToCache('guild-5', 'ban', 'role-array');
    const member = {
      roles: { cache: [{ id: 'role-array' }] },
      permissions: { has: () => false }
    };

    expect(hasActionPermission('guild-5', member, 'ban')).toBe(true);
  });

  test('removeRoleFromCache ignores missing action maps', () => {
    addRoleToCache('guild-6', 'warn', 'role-remove');
    removeRoleFromCache('guild-6', 'ban', 'role-x');
    expect(roleCache.get('guild-6').get('warn').has('role-remove')).toBe(true);
  });

  test('hasActionPermission returns false when member roles missing', () => {
    addRoleToCache('guild-7', 'warn', 'role-7');
    const member = {
      roles: null,
      permissions: { has: () => false }
    };

    expect(hasActionPermission('guild-7', member, 'warn')).toBe(false);
  });

  test('removeRoleFromCache tolerates missing data', () => {
    removeRoleFromCache('missing', 'warn', 'role-none');
    addRoleToCache('guild-6', 'warn', 'role-remove');
    removeRoleFromCache('guild-6', 'warn', 'role-remove');
    expect(roleCache.get('guild-6')).toBeUndefined();
  });

  test('hasActionPermission returns false when member is null', () => {
    expect(hasActionPermission('guild-null', null, 'warn')).toBe(false);
  });

  test('hasActionPermission returns false for unknown action', () => {
    const member = { permissions: { has: () => true } };
    expect(hasActionPermission('guild-unknown', member, 'unknown')).toBe(false);
  });
});

describe('handleAutoBanRoleUpdate', () => {
  let guild;
  let botMember;
  let targetUser;

  beforeEach(() => {
    database.__pool.query.mockReset();
    database.__pool.query.mockResolvedValue([[]]);

    targetUser = {
      id: 'user-1',
      tag: 'user-1#0001',
      send: jest.fn().mockResolvedValue(undefined)
    };

    botMember = {
      permissions: { has: jest.fn().mockReturnValue(true) },
      roles: {
        highest: {
          comparePositionTo: jest.fn().mockReturnValue(1)
        }
      }
    };

    guild = {
      id: 'guild-trap',
      name: 'Trap Guild',
      members: {
        me: botMember,
        ban: jest.fn().mockResolvedValue(undefined)
      }
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createMember(roleIds = [], overrides = {}) {
    const cache = new Map(roleIds.map(roleId => [roleId, { id: roleId }]));
    return {
      id: overrides.id ?? targetUser.id,
      guild,
      user: overrides.user ?? targetUser,
      roles: {
        cache,
        highest: overrides.highest ?? {
          id: 'role-top',
          comparePositionTo: jest.fn().mockReturnValue(-1)
        }
      },
      ...overrides
    };
  }

  test('returns when guild context missing', async () => {
    await handleAutoBanRoleUpdate({}, { guild: null });
    expect(guild.members.ban).not.toHaveBeenCalled();
  });

  test('ignores bot members', async () => {
    const newMember = createMember(['role-trap'], { user: { ...targetUser, bot: true } });
    await handleAutoBanRoleUpdate(null, newMember);
    expect(guild.members.ban).not.toHaveBeenCalled();
  });

  test('skips when trap role not configured', async () => {
    database.__pool.query.mockResolvedValueOnce([[]]);

    const oldMember = createMember([]);
    const newMember = createMember(['role-trap']);

    await handleAutoBanRoleUpdate(oldMember, newMember);

    expect(guild.members.ban).not.toHaveBeenCalled();
  });

  test('skips when trap role not newly assigned', async () => {
    database.__pool.query.mockResolvedValueOnce([[{ trap_role_id: 'role-trap' }]]);

    const oldMember = createMember(['role-trap']);
    const newMember = createMember(['role-trap']);

    await handleAutoBanRoleUpdate(oldMember, newMember);

    expect(guild.members.ban).not.toHaveBeenCalled();
  });

  test('skips when bot lacks ban permission', async () => {
    database.__pool.query.mockResolvedValueOnce([[{ trap_role_id: 'role-trap' }]]);
    botMember.permissions.has.mockReturnValue(false);

    const oldMember = createMember([]);
    const newMember = createMember(['role-trap']);

    await handleAutoBanRoleUpdate(oldMember, newMember);

    expect(guild.members.ban).not.toHaveBeenCalled();
  });

  test('bans when trap role assigned', async () => {
    database.__pool.query.mockResolvedValueOnce([[{ trap_role_id: 'role-trap' }]]);

    const oldMember = createMember([]);
    const newMember = createMember(['role-trap']);

    await handleAutoBanRoleUpdate(oldMember, newMember);

    expect(guild.members.ban).toHaveBeenCalledWith('user-1', { reason: 'Assigned the configured moderation trap role.' });
  });

  test('logs when ban request fails', async () => {
    database.__pool.query.mockResolvedValueOnce([[{ trap_role_id: 'role-trap' }]]);
    guild.members.ban.mockRejectedValueOnce(new Error('ban failed'));

    const oldMember = createMember([]);
    const newMember = createMember(['role-trap']);

    await handleAutoBanRoleUpdate(oldMember, newMember);

    expect(guild.members.ban).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      'autoBanTrap: failed to execute trap ban',
      expect.objectContaining({ guildId: guild.id, userId: targetUser.id }),
      expect.any(Error)
    );
  });

  test('skips when bot hierarchy is lower than target', async () => {
    database.__pool.query.mockResolvedValueOnce([[{ trap_role_id: 'role-trap' }]]);
    botMember.roles.highest.comparePositionTo.mockReturnValue(0);

    const oldMember = createMember([]);
    const newMember = createMember(['role-trap']);

    await handleAutoBanRoleUpdate(oldMember, newMember);

    expect(guild.members.ban).not.toHaveBeenCalled();
  });
});

describe('fetchTrapRoleId', () => {
  test('returns null when guild id missing', async () => {
    expect(await fetchTrapRoleId(null)).toBeNull();
  });

  test('returns null when query fails', async () => {
    database.__pool.query.mockRejectedValueOnce(new Error('load failed'));
    const result = await fetchTrapRoleId('guild-trap');
    expect(result).toBeNull();
    expect(database.__pool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT trap_role_id'),
      ['guild-trap']
    );
  });
});


describe('trap role helpers', () => {
  test('setTrapRoleId persists configuration', async () => {
    database.__pool.query.mockReset();
    database.__pool.query.mockResolvedValue([[]]);
    await autoBanTrap.setTrapRoleId('guild-helper', 'role-helper', 'admin-1');
    expect(database.__pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO moderation_config'),
      ['guild-helper', 'role-helper', 'admin-1']
    );
  });

  test('clearTrapRoleId nulls configuration', async () => {
    database.__pool.query.mockReset();
    database.__pool.query.mockResolvedValue([[]]);
    await autoBanTrap.clearTrapRoleId('guild-helper', 'admin-1');
    expect(database.__pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO moderation_config'),
      ['guild-helper', 'admin-1']
    );
  });
});

describe('isTrapRoleNewlyAssigned', () => {
  test('returns false when trap role missing', () => {
    expect(isTrapRoleNewlyAssigned(null, null, null)).toBe(false);
  });

  test('returns false when role not present on new member', () => {
    const newMember = { roles: { cache: new Map() } };
    expect(isTrapRoleNewlyAssigned(null, newMember, 'role-trap')).toBe(false);
  });

  test('returns true when role added', () => {
    const oldMember = { roles: { cache: new Map() } };
    const newMember = { roles: { cache: new Map([['role-trap', { id: 'role-trap' }]]) } };
    expect(isTrapRoleNewlyAssigned(oldMember, newMember, 'role-trap')).toBe(true);
  });
});

describe('registerAutoBanTrap', () => {
  test('registers guild member update listener', () => {
    const client = { on: jest.fn() };

    autoBanTrap.registerAutoBanTrap(client);

    expect(client.on).toHaveBeenCalledWith(Events.GuildMemberUpdate, expect.any(Function));
  });

  test('registered listener processes trap assignment', async () => {
    const client = { on: jest.fn() };
    autoBanTrap.registerAutoBanTrap(client);

    const handler = client.on.mock.calls.find(call => call[0] === Events.GuildMemberUpdate)[1];

    const guild = {
      id: 'guild-listener',
      members: {
        me: {
          permissions: { has: () => true },
          roles: { highest: { comparePositionTo: () => 1 } }
        },
        ban: jest.fn().mockResolvedValue(undefined)
      }
    };

    const oldMember = {
      guild,
      user: { id: 'user-listener', tag: 'User#0001' },
      roles: { cache: new Map() }
    };

    const newMember = {
      guild,
      user: { id: 'user-listener', tag: 'User#0001' },
      roles: {
        cache: new Map([['trap-role', { id: 'trap-role' }]]),
        highest: { comparePositionTo: () => -1 }
      }
    };

    database.__pool.query.mockResolvedValueOnce([[{ trap_role_id: 'trap-role' }]]);

    await handler(oldMember, newMember);
    await flushPromises();

    expect(guild.members.ban).toHaveBeenCalledWith('user-listener', { reason: 'Assigned the configured moderation trap role.' });
  });
});

describe('handleModCommand', () => {
  beforeEach(() => {
    roleCache.clear();
    database.__pool.query.mockReset();
    database.__pool.query.mockResolvedValue([[]]);
  });

  test('adds a moderation role and updates cache', async () => {
    const role = { id: 'role-add', toString: () => '@Moderators' };
    const interaction = {
      guildId: 'guild-add',
      options: {
        getSubcommandGroup: () => 'roles',
        getSubcommand: () => 'add',
        getString: () => 'warn',
        getRole: () => role
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined)
    };

    await handleModCommand(interaction);

    expect(database.__pool.query).toHaveBeenCalledWith(
      'INSERT IGNORE INTO moderation_roles (guild_id, action, role_id) VALUES (?, ?, ?)',
      ['guild-add', 'warn', 'role-add']
    );
    const roles = roleCache.get('guild-add').get('warn');
    expect(roles.has('role-add')).toBe(true);
    expect(interaction.editReply).toHaveBeenCalledWith('Added @Moderators to the **1. Warn User** role list.');
  });

  test('adds timeout moderation role without enum failures', async () => {
    const role = { id: 'role-timeout', toString: () => '@TimeoutMods' };
    const interaction = {
      guildId: 'guild-timeout',
      options: {
        getSubcommandGroup: () => 'roles',
        getSubcommand: () => 'add',
        getString: () => 'timeout',
        getRole: () => role
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined)
    };

    await handleModCommand(interaction);

    expect(database.__pool.query).toHaveBeenCalledWith(
      'INSERT IGNORE INTO moderation_roles (guild_id, action, role_id) VALUES (?, ?, ?)',
      ['guild-timeout', 'timeout', 'role-timeout']
    );

    const actionMap = roleCache.get('guild-timeout');
    expect(actionMap).toBeDefined();
    expect(actionMap.get('timeout')?.has('role-timeout')).toBe(true);
    expect(interaction.editReply).toHaveBeenCalledWith('Added @TimeoutMods to the **2. Timeout User** role list.');
  });

  test('removes moderation role when present', async () => {
    addRoleToCache('guild-remove', 'kick', 'role-remove');
    const role = { id: 'role-remove', toString: () => '@TempMods' };
    database.__pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const interaction = {
      guildId: 'guild-remove',
      options: {
        getSubcommandGroup: () => 'roles',
        getSubcommand: () => 'remove',
        getString: () => 'kick',
        getRole: () => role
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined)
    };

    await handleModCommand(interaction);

    expect(database.__pool.query).toHaveBeenCalledWith(
      'DELETE FROM moderation_roles WHERE guild_id = ? AND action = ? AND role_id = ?',
      ['guild-remove', 'kick', 'role-remove']
    );
    const roles = roleCache.get('guild-remove')?.get('kick') || new Set();
    expect(roles.has('role-remove')).toBe(false);
    expect(roleCache.has('guild-remove')).toBe(false);
    expect(interaction.editReply).toHaveBeenCalledWith('Removed @TempMods from the **3. Kick User** role list.');
  });

  test('returns when deferReply fails during add', async () => {
    const role = { id: 'role-fail', toString: () => '@FailRole' };
    const interaction = {
      guildId: 'guild-fail',
      options: {
        getSubcommandGroup: () => 'roles',
        getSubcommand: () => 'add',
        getString: () => 'warn',
        getRole: () => role
      },
      deferReply: jest.fn().mockRejectedValue(new Error('discord down')),
      editReply: jest.fn()
    };

    await handleModCommand(interaction);

    expect(database.__pool.query).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  test('surfaces database errors during add', async () => {
    const role = { id: 'role-db', toString: () => '@DbRole' };
    database.__pool.query.mockRejectedValueOnce(new Error('db fail'));
    const interaction = {
      guildId: 'guild-db',
      options: {
        getSubcommandGroup: () => 'roles',
        getSubcommand: () => 'add',
        getString: () => 'warn',
        getRole: () => role
      },
      deferReply: jest.fn().mockImplementation(function () {
        interaction.deferred = true;
        return Promise.resolve();
      }),
      editReply: jest.fn().mockResolvedValue(undefined)
    };

    await handleModCommand(interaction);

    expect(interaction.editReply).toHaveBeenLastCalledWith('Failed to add the moderation role. Please try again later.');
  });

  test('surfaces database errors during remove', async () => {
    const role = { id: 'role-db-remove', toString: () => '@DbRemove' };
    database.__pool.query.mockRejectedValueOnce(new Error('db fail'));
    const interaction = {
      guildId: 'guild-db-remove',
      options: {
        getSubcommandGroup: () => 'roles',
        getSubcommand: () => 'remove',
        getString: () => 'warn',
        getRole: () => role
      },
      deferReply: jest.fn().mockImplementation(function () {
        interaction.deferred = true;
        return Promise.resolve();
      }),
      editReply: jest.fn().mockResolvedValue(undefined)
    };

    await handleModCommand(interaction);

    expect(interaction.editReply).toHaveBeenLastCalledWith('Failed to remove the moderation role. Please try again later.');
  });

  test('returns error for unsupported group', async () => {
    const interaction = {
      options: {
        getSubcommandGroup: () => null
      },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await handleModCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Unsupported moderation command.'
    }));
  });

  test('delegates auto-ban configuration', async () => {
    const trapSpy = jest.spyOn(autoBanTrap, 'handleTrapConfigCommand').mockResolvedValue(undefined);
    const interaction = {
      options: {
        getSubcommandGroup: () => 'auto-ban',
        getSubcommand: () => 'set'
      }
    };

    await handleModCommand(interaction);

    expect(trapSpy).toHaveBeenCalledWith(interaction);
    trapSpy.mockRestore();
  });
});

describe('handleTrapConfigCommand', () => {
  beforeEach(() => {
    database.__pool.query.mockReset();
    database.__pool.query.mockResolvedValue([[]]);
  });

  test('sets the trap role', async () => {
    const role = { id: 'role-trap', toString: () => '<@&role-trap>' };
    const interaction = {
      guildId: 'guild-trap',
      options: {
        getSubcommand: () => 'set',
        getRole: () => role
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      user: { id: 'admin-1' }
    };

    await handleTrapConfigCommand(interaction);

    expect(database.__pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO moderation_config'),
      ['guild-trap', 'role-trap', 'admin-1']
    );
    expect(interaction.editReply).toHaveBeenCalledWith('Marked <@&role-trap> as the trap role.');
  });

  test('clears the trap role', async () => {
    const interaction = {
      guildId: 'guild-trap',
      options: {
        getSubcommand: () => 'clear'
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      user: { id: 'admin-1' }
    };

    await handleTrapConfigCommand(interaction);

    expect(database.__pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO moderation_config'),
      ['guild-trap', 'admin-1']
    );
    expect(interaction.editReply).toHaveBeenCalledWith('Cleared the configured trap role.');
  });

  test('handles query failures gracefully', async () => {
    const error = new Error('db down');
    database.__pool.query.mockRejectedValueOnce(error);

    const interaction = {
      guildId: 'guild-trap',
      options: {
        getSubcommand: () => 'set',
        getRole: () => ({ id: 'role-trap', toString: () => '<@&role-trap>' })
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      user: { id: 'admin-1' }
    };

    await handleTrapConfigCommand(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith('Failed to update the trap role. Please try again later.');
  });

  test('handles clear failures gracefully', async () => {
    database.__pool.query.mockRejectedValueOnce(new Error('clear failed'));

    const interaction = {
      guildId: 'guild-trap',
      options: {
        getSubcommand: () => 'clear'
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      user: { id: 'admin-1' }
    };

    await handleTrapConfigCommand(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith('Failed to clear the trap role. Please try again later.');
  });

  test('handles unsupported subcommand', async () => {
    const interaction = {
      guildId: 'guild-trap',
      options: {
        getSubcommand: () => 'unknown'
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined)
    };

    await handleTrapConfigCommand(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith('Unsupported trap role command.');
  });
});

describe('logAction', () => {
  beforeEach(() => {
    database.__pool.query.mockReset();
    database.__pool.query.mockResolvedValue([[]]);
  });

  test('inserts a moderation action record', async () => {
    const targetUser = { id: 'user-1', tag: 'User#0001' };
    const moderator = { id: 'mod-1', tag: 'Mod#0001' };

    await logAction({ guildId: 'guild-1', action: 'timeout', targetUser, moderator, reason: 'spam' });

    expect(database.__pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO moderation_actions'),
      ['guild-1', 'timeout', 'user-1', 'User#0001', 'mod-1', 'Mod#0001', 'spam']
    );
  });

  test('falls back to username when tag is absent', async () => {
    const targetUser = { id: 'user-2', username: 'targetname' };
    const moderator = { id: 'mod-2', username: 'modname' };

    await logAction({ guildId: 'guild-2', action: 'ban', targetUser, moderator, reason: 'reason' });

    expect(database.__pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO moderation_actions'),
      ['guild-2', 'ban', 'user-2', 'targetname', 'mod-2', 'modname', 'reason']
    );
  });

  test('uses null when tag and username are both absent', async () => {
    const targetUser = { id: 'user-none' };
    const moderator = { id: 'mod-none' };

    await logAction({ guildId: 'guild-none', action: 'warn', targetUser, moderator, reason: 'r' });

    expect(database.__pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO moderation_actions'),
      ['guild-none', 'warn', 'user-none', null, 'mod-none', null, 'r']
    );
  });

  test('logs error and does not throw when query fails', async () => {
    database.__pool.query.mockRejectedValueOnce(new Error('db down'));
    const targetUser = { id: 'user-3', tag: 'User#0003' };
    const moderator = { id: 'mod-3', tag: 'Mod#0003' };

    await expect(
      logAction({ guildId: 'guild-3', action: 'warn', targetUser, moderator, reason: 'test' })
    ).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(
      'moderation: failed to log action',
      expect.objectContaining({ guildId: 'guild-3', action: 'warn', targetId: 'user-3' }),
      expect.any(Error)
    );
  });
});











